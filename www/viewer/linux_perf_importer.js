// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Imports text files in the Linux event trace format into the
 * timeline model. This format is output both by sched_trace and by Linux's perf
 * tool.
 *
 * This importer assumes the events arrive as a string. The unit tests provide
 * examples of the trace format.
 *
 * Linux scheduler traces use a definition for 'pid' that is different than
 * tracing uses. Whereas tracing uses pid to identify a specific process, a pid
 * in a linux trace refers to a specific thread within a process. Within this
 * file, we the definition used in Linux traces, as it improves the importing
 * code's readability.
 */
cr.define('tracing', function() {
  /**
   * Represents the scheduling state for a single thread.
   * @constructor
   */
  function CpuState(cpu) {
    this.cpu = cpu;
  }

  CpuState.prototype = {
    __proto__: Object.prototype,

    /**
     * Switches the active pid on this Cpu. If necessary, add a TimelineSlice
     * to the cpu representing the time spent on that Cpu since the last call to
     * switchRunningLinuxPid.
     */
    switchRunningLinuxPid: function(importer, prevState, ts, pid, comm, prio) {
      // Generate a slice if the last active pid was not the idle task
      if (this.lastActivePid !== undefined && this.lastActivePid != 0) {
        var duration = ts - this.lastActiveTs;
        var thread = importer.threadsByLinuxPid[this.lastActivePid];
        if (thread)
          name = thread.userFriendlyName;
        else
          name = this.lastActiveComm;

        var slice = new tracing.TimelineSlice(name,
                                              tracing.getStringColorId(name),
                                              this.lastActiveTs,
                                              {comm: this.lastActiveComm,
                                               tid: this.lastActivePid,
                                               prio: this.lastActivePrio,
                                               stateWhenDescheduled: prevState
                                              },
                                              duration);
        this.cpu.slices.push(slice);
      }

      this.lastActiveTs = ts;
      this.lastActivePid = pid;
      this.lastActiveComm = comm;
      this.lastActivePrio = prio;
    }
  };

  function ThreadState(tid) {
    this.openSlices = [];
  }

  /**
   * Imports linux perf events into a specified model.
   * @constructor
   */
  function LinuxPerfImporter(model, events, isAdditionalImport) {
    this.isAdditionalImport_ = isAdditionalImport;
    this.model_ = model;
    this.events_ = events;
    this.clockSyncRecords_ = [];
    this.cpuStates_ = {};
    this.kernelThreadStates_ = {};
    this.buildMapFromLinuxPidsToTimelineThreads();

    // To allow simple indexing of threads, we store all the threads by their
    // kernel KPID. The KPID is a unique key for a thread in the trace.
    this.threadStateByKPID_ = {};
  }

  TestExports = {};

  // Matches the generic trace record:
  //          <idle>-0     [001]  1.23: sched_switch
  var lineRE = /^\s*(.+?)\s+\[(\d+)\]\s*(\d+\.\d+):\s+(\S+):\s(.*)$/;
  TestExports.lineRE = lineRE;

  // Matches the sched_switch record
  var schedSwitchRE = new RegExp(
      'prev_comm=(.+) prev_pid=(\\d+) prev_prio=(\\d+) prev_state=(\\S) ==> ' +
      'next_comm=(.+) next_pid=(\\d+) next_prio=(\\d+)');
  TestExports.schedSwitchRE = schedSwitchRE;

  // Matches the sched_wakeup record
  var schedWakeupRE =
      /comm=(.+) pid=(\d+) prio=(\d+) success=(\d+) target_cpu=(\d+)/;
  TestExports.schedWakeupRE = schedWakeupRE;

  // Matches the trace_event_clock_sync record
  //  0: trace_event_clock_sync: parent_ts=19581477508
  var traceEventClockSyncRE = /trace_event_clock_sync: parent_ts=(\d+\.?\d*)/;
  TestExports.traceEventClockSyncRE = traceEventClockSyncRE;

  // Matches the workqueue_execute_start record
  //  workqueue_execute_start: work struct c7a8a89c: function MISRWrapper
  var workqueueExecuteStartRE = /work struct (.+): function (\S+)/;

  // Matches the workqueue_execute_start record
  //  workqueue_execute_end: work struct c7a8a89c
  var workqueueExecuteEndRE = /work struct (.+)/;

  /**
   * Guesses whether the provided events is a Linux perf string.
   * Looks for the magic string "# tracer" at the start of the file,
   * or the typical task-pid-cpu-timestamp-function sequence of a typical
   * trace's body.
   *
   * @return {boolean} True when events is a linux perf array.
   */
  LinuxPerfImporter.canImport = function(events) {
    if (!(typeof(events) === 'string' || events instanceof String))
      return false;

    if (/^# tracer:/.exec(events))
      return true;

    var m = /^(.+)\n/.exec(events);
    if (m)
      events = m[1];
    if (lineRE.exec(events))
      return true;

    return false;
  };

  LinuxPerfImporter.prototype = {
    __proto__: Object.prototype,

    /**
     * Precomputes a lookup table from linux pids back to existing
     * TimelineThreads. This is used during importing to add information to each
     * timeline thread about whether it was running, descheduled, sleeping, et
     * cetera.
     */
    buildMapFromLinuxPidsToTimelineThreads: function() {
      this.threadsByLinuxPid = {};
      this.model_.getAllThreads().forEach(
          function(thread) {
            this.threadsByLinuxPid[thread.tid] = thread;
          }.bind(this));
    },

    /**
     * @return {CpuState} A CpuState corresponding to the given cpuNumber.
     */
    getOrCreateCpuState: function(cpuNumber) {
      if (!this.cpuStates_[cpuNumber]) {
        var cpu = this.model_.getOrCreateCpu(cpuNumber);
        this.cpuStates_[cpuNumber] = new CpuState(cpu);
      }
      return this.cpuStates_[cpuNumber];
    },

    /**
     * @return {number} The pid extracted from the kernel thread name.
     */
    parsePid: function(kernelThreadName) {
        var pid = /.+-(\d+)/.exec(kernelThreadName)[1];
        pid = parseInt(pid);
        return pid;
    },

    /**
     * @return {number} The string portion of the thread extracted from the
     * kernel thread name.
     */
    parseThreadName: function(kernelThreadName) {
        return /(.+)-\d+/.exec(kernelThreadName)[1];
    },

    /**
     * @return {TimelinThread} A thread corresponding to the kernelThreadName
     */
    getOrCreateKernelThread: function(kernelThreadName) {
      if (!this.kernelThreadStates_[kernelThreadName]) {
        pid = this.parsePid(kernelThreadName);

        var thread = this.model_.getOrCreateProcess(pid).getOrCreateThread(pid);
        thread.name = kernelThreadName;
        this.kernelThreadStates_[kernelThreadName] = {
          pid: pid,
          thread: thread,
          openSlice: undefined,
          openSliceTS: undefined
        };
        this.threadsByLinuxPid[pid] = thread;
      }
      return this.kernelThreadStates_[kernelThreadName];
    },

    /**
     * Imports the data in this.events_ into model_.
     */
    importEvents: function() {
      this.importCpuData();
      if (!this.alignClocks())
        return;
      this.buildPerThreadCpuSlicesFromCpuState();
    },

    /**
     * Builds the cpuSlices array on each thread based on our knowledge of what
     * each Cpu is doing.  This is done only for TimelineThreads that are
     * already in the model, on the assumption that not having any traced data
     * on a thread means that it is not of interest to the user.
     */
    buildPerThreadCpuSlicesFromCpuState: function() {
      // Push the cpu slices to the threads that they run on.
      for (var cpuNumber in this.cpuStates_) {
        var cpuState = this.cpuStates_[cpuNumber];
        var cpu = cpuState.cpu;

        for (var i = 0; i < cpu.slices.length; i++) {
          var slice = cpu.slices[i];

          var thread = this.threadsByLinuxPid[slice.args.tid];
          if (!thread)
            continue;
          if (!thread.tempCpuSlices)
            thread.tempCpuSlices = [];

          // Because Chrome's Array.sort is not a stable sort, we need to keep
          // the slice index around to keep slices with identical start times in
          // the proper order when sorting them.
          slice.index = i;

          thread.tempCpuSlices.push(slice);
        }
      }

      // Create slices for when the thread is not running.
      var runningId = tracing.getColorIdByName('running');
      var runnableId = tracing.getColorIdByName('runnable');
      var sleepingId = tracing.getColorIdByName('sleeping');
      var ioWaitId = tracing.getColorIdByName('iowait');
      this.model_.getAllThreads().forEach(function(thread) {
        if (!thread.tempCpuSlices)
          return;
        var origSlices = thread.tempCpuSlices;
        delete thread.tempCpuSlices;

        origSlices.sort(function(x, y) {
          var delta = x.start - y.start;
          if (delta == 0) {
            // Break ties using the original slice ordering.
            return x.index - y.index;
          } else {
            return delta;
          }
        });

        // Walk the slice list and put slices between each original slice
        // to show when the thread isn't running
        var slices = [];
        if (origSlices.length) {
          var slice = origSlices[0];
          slices.push(new tracing.TimelineSlice('Running', runningId,
              slice.start, {}, slice.duration));
        }
        for (var i = 1; i < origSlices.length; i++) {
          var prevSlice = origSlices[i - 1];
          var nextSlice = origSlices[i];
          var midDuration = nextSlice.start - prevSlice.end;
          if (prevSlice.args.stateWhenDescheduled == 'S') {
            slices.push(new tracing.TimelineSlice('Sleeping', sleepingId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'R') {
            slices.push(new tracing.TimelineSlice('Runnable', runnableId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'D') {
            slices.push(new tracing.TimelineSlice('I/O Wait', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'T') {
            slices.push(new tracing.TimelineSlice('__TASK_STOPPED', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 't') {
            slices.push(new tracing.TimelineSlice('debug', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'Z') {
            slices.push(new tracing.TimelineSlice('Zombie', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'X') {
            slices.push(new tracing.TimelineSlice('Exit Dead', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'x') {
            slices.push(new tracing.TimelineSlice('Task Dead', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'W') {
            slices.push(new tracing.TimelineSlice('WakeKill', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else {
            throw 'Unrecognized state: ' + prevSlice.args.stateWhenDescheduled;
          }

          slices.push(new tracing.TimelineSlice('Running', runningId,
              nextSlice.start, {}, nextSlice.duration));
        }
        thread.cpuSlices = slices;
      });
    },

    /**
     * Walks the slices stored on this.cpuStates_ and adjusts their timestamps
     * based on any alignment metadata we discovered.
     */
    alignClocks: function() {
      if (this.clockSyncRecords_.length == 0) {
        // If this is an additional import, and no clock syncing records were
        // found, then abort the import. Otherwise, just skip clock alignment.
        if (!this.isAdditionalImport_)
          return;

        // Remove the newly imported CPU slices from the model.
        this.abortImport();
        return false;
      }

      // Shift all the slice times based on the sync record.
      var sync = this.clockSyncRecords_[0];
      var timeShift = sync.parentTS - sync.perfTS;
      for (var cpuNumber in this.cpuStates_) {
        var cpuState = this.cpuStates_[cpuNumber];
        var cpu = cpuState.cpu;

        for (var i = 0; i < cpu.slices.length; i++) {
          var slice = cpu.slices[i];
          slice.start = slice.start + timeShift;
          slice.duration = slice.duration;
        }

        for (var counterName in cpu.counters) {
          var counter = cpu.counters[counterName];
          for (var sI = 0; sI < counter.timestamps.length; sI++)
            counter.timestamps[sI] = (counter.timestamps[sI] + timeShift);
        }
      }
      for (var kernelThreadName in this.kernelThreadStates_) {
        var kthread = this.kernelThreadStates_[kernelThreadName];
        var thread = kthread.thread;
        for (var i = 0; i < thread.subRows[0].length; i++) {
          thread.subRows[0][i].start += timeShift;
        }
      }
      return true;
    },

    /**
     * Removes any data that has been added to the model because of an error
     * detected during the import.
     */
    abortImport: function() {
      if (this.pushedEventsToThreads)
        throw 'Cannot abort, have alrady pushedCpuDataToThreads.';

      for (var cpuNumber in this.cpuStates_)
        delete this.model_.cpus[cpuNumber];
      for (var kernelThreadName in this.kernelThreadStates_) {
        var kthread = this.kernelThreadStates_[kernelThreadName];
        var thread = kthread.thread;
        var process = thread.parent;
        delete process.threads[thread.tid];
        delete this.model_.processes[process.pid];
      }
      this.model_.importErrors.push(
          'Cannot import kernel trace without a clock sync.');
    },

    /**
     * Records the fact that a pid has become runnable. This data will
     * eventually get used to derive each thread's cpuSlices array.
     */
    markPidRunnable: function(ts, pid, comm, prio) {
      // TODO(nduca): implement this functionality.
    },

    /**
     * Helper to process a 'begin' event (e.g. initiate a slice).
     * @param {ThreadState} state Thread state (holds slices).
     * @param {string} name The trace event name.
     * @param {number} ts The trace event begin timestamp.
     */
    processBegin: function(state, tname, name, ts, pid, tid) {
      var colorId = tracing.getStringColorId(name);
      var slice = new tracing.TimelineSlice(name, colorId, ts, null);
      // XXX: Should these be removed from the slice before putting it into the
      // model?
      slice.pid = pid;
      slice.tid = tid;
      slice.threadName = tname;
      state.openSlices.push(slice);
    },

    /**
     * Helper to process an 'end' event (e.g. close a slice).
     * @param {ThreadState} state Thread state (holds slices).
     * @param {number} ts The trace event begin timestamp.
     */
    processEnd: function(state, ts) {
      if (state.openSlices.length == 0) {
        // Ignore E events that are unmatched.
        return;
      }
      var slice = state.openSlices.pop();
      slice.duration = ts - slice.start;

      // Store the slice on the correct subrow.
      var thread = this.model_.getOrCreateProcess(slice.pid).
          getOrCreateThread(slice.tid);
      if (!thread.name)
        thread.name = slice.threadName;
      this.threadsByLinuxPid[slice.tid] = thread;
      var subRowIndex = state.openSlices.length;
      thread.getSubrow(subRowIndex).push(slice);

      // Add the slice to the subSlices array of its parent.
      if (state.openSlices.length) {
        var parentSlice = state.openSlices[state.openSlices.length - 1];
        parentSlice.subSlices.push(slice);
      }
    },

    /**
     * Helper function that closes any open slices. This happens when a trace
     * ends before an 'E' phase event can get posted. When that happens, this
     * closes the slice at the highest timestamp we recorded and sets the
     * didNotFinish flag to true.
     */
    autoCloseOpenSlices: function() {
      // We need to know the model bounds in order to assign an end-time to
      // the open slices.
      this.model_.updateBounds();

      // The model's max value in the trace is wrong at this point if there are
      // un-closed events. To close those events, we need the true global max
      // value. To compute this, build a list of timestamps that weren't
      // included in the max calculation, then compute the real maximum based
      // on that.
      var openTimestamps = [];
      for (var kpid in this.threadStateByKPID_) {
        var state = this.threadStateByKPID_[kpid];
        for (var i = 0; i < state.openSlices.length; i++) {
          var slice = state.openSlices[i];
          openTimestamps.push(slice.start);
          for (var s = 0; s < slice.subSlices.length; s++) {
            var subSlice = slice.subSlices[s];
            openTimestamps.push(subSlice.start);
            if (subSlice.duration)
              openTimestamps.push(subSlice.end);
          }
        }
      }

      // Figure out the maximum value of model.maxTimestamp and
      // Math.max(openTimestamps). Made complicated by the fact that the model
      // timestamps might be undefined.
      var realMaxTimestamp;
      if (this.model_.maxTimestamp) {
        realMaxTimestamp = Math.max(this.model_.maxTimestamp,
                                    Math.max.apply(Math, openTimestamps));
      } else {
        realMaxTimestamp = Math.max.apply(Math, openTimestamps);
      }

      // Automatically close any slices are still open. These occur in a number
      // of reasonable situations, e.g. deadlock. This pass ensures the open
      // slices make it into the final model.
      for (var kpid in this.threadStateByKPID_) {
        var state = this.threadStateByKPID_[kpid];
        while (state.openSlices.length > 0) {
          var slice = state.openSlices.pop();
          slice.duration = realMaxTimestamp - slice.start;
          slice.didNotFinish = true;

          // Store the slice on the correct subrow.
          var thread = this.model_.getOrCreateProcess(slice.pid)
                           .getOrCreateThread(slice.tid);
          var subRowIndex = state.openSlices.length;
          thread.getSubrow(subRowIndex).push(slice);

          // Add the slice to the subSlices array of its parent.
          if (state.openSlices.length) {
            var parentSlice = state.openSlices[state.openSlices.length - 1];
            parentSlice.subSlices.push(slice);
          }
        }
      }
    },

    /**
     * Helper that creates and adds samples to a TimelineCounter object based on
     * 'C' phase events.
     */
    processCounter: function(name, ts, value, pid) {
      var ctr = this.model_.getOrCreateProcess(pid)
          .getOrCreateCounter('', name);

      // Initialize the counter's series fields if needed.
      //
      if (ctr.numSeries == 0) {
        ctr.seriesNames.push('state');
        ctr.seriesColors.push(
            tracing.getStringColorId(ctr.name + '.' + 'state'));
      }

      // Add the sample values.
      ctr.timestamps.push(ts);
      ctr.samples.push(value);
    },


    /**
     * Walks the this.events_ structure and creates TimelineCpu objects.
     */
    importCpuData: function() {
      this.lines_ = this.events_.split('\n');

      for (var lineNumber = 0; lineNumber < this.lines_.length; ++lineNumber) {
        var line = this.lines_[lineNumber];
        if (/^#/.exec(line) || line.length == 0)
          continue;
        var eventBase = lineRE.exec(line);
        if (!eventBase) {
          this.model_.importErrors.push('Line ' + (lineNumber + 1) +
              ': Unrecognized line: ' + line);
          continue;
        }

        var cpuState = this.getOrCreateCpuState(parseInt(eventBase[2]));
        var ts = parseFloat(eventBase[3]) * 1000;

        var eventName = eventBase[4];

        if (eventName == 'sched_switch') {
          var event = schedSwitchRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed sched_switch event');
            continue;
          }

          var prevState = event[4];
          var nextComm = event[5];
          var nextPid = parseInt(event[6]);
          var nextPrio = parseInt(event[7]);
          cpuState.switchRunningLinuxPid(
              this, prevState, ts, nextPid, nextComm, nextPrio);

        } else if (eventName == 'sched_wakeup') {
          var event = schedWakeupRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed sched_wakeup event');
            continue;
          }

          var comm = event[1];
          var pid = parseInt(event[2]);
          var prio = parseInt(event[3]);
          this.markPidRunnable(ts, pid, comm, prio);

        } else if (eventName == 'cpu_frequency') {
          var event = /state=(\d+) cpu_id=(\d+)/.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed cpu_frequency event');
            continue;
          }
          var targetCpuNumber = parseInt(event[2]);
          var targetCpu = this.getOrCreateCpuState(targetCpuNumber);
          var freqCounter =
              targetCpu.cpu.getOrCreateCounter('', 'Frequency');
          if (freqCounter.numSeries == 0) {
            freqCounter.seriesNames.push('state');
            freqCounter.seriesColors.push(
                tracing.getStringColorId(freqCounter.name + '.' + 'state'));
          }
          var freqState = parseInt(event[1]);
          freqCounter.timestamps.push(ts);
          freqCounter.samples.push(freqState);
        } else if (eventName == 'cpufreq_interactive_already' ||
                   eventName == 'cpufreq_interactive_target') {
          var event = /cpu=(\d+) load=(\d+) cur=(\d+) targ=(\d+)/.
              exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed cpufreq_interactive_* event');
            continue;
          }
          var targetCpuNumber = parseInt(event[1]);
          var targetCpu = this.getOrCreateCpuState(targetCpuNumber);
          var loadCounter =
              targetCpu.cpu.getOrCreateCounter('', 'Load');
          if (loadCounter.numSeries == 0) {
            loadCounter.seriesNames.push('state');
            loadCounter.seriesColors.push(
                tracing.getStringColorId(loadCounter.name + '.' + 'state'));
          }
          var loadState = parseInt(event[2]);
          loadCounter.timestamps.push(ts);
          loadCounter.samples.push(loadState);
          loadCounter.maxTotal = 100;
          loadCounter.skipUpdateBounds = true;
        } else if (eventName == 'workqueue_execute_start') {
          var event = workqueueExecuteStartRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed workqueue_execute_start event');
            continue;
          }
          var kthread = this.getOrCreateKernelThread(eventBase[1]);
          kthread.openSliceTS = ts;
          kthread.openSlice = event[2];

        } else if (eventName == 'workqueue_execute_end') {
          var event = workqueueExecuteEndRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed workqueue_execute_start event');
            continue;
          }
          var kthread = this.getOrCreateKernelThread(eventBase[1]);
          if (kthread.openSlice) {
            var slice = new tracing.TimelineSlice(kthread.openSlice,
                tracing.getStringColorId(kthread.openSlice),
                kthread.openSliceTS,
                {},
                ts - kthread.openSliceTS);

            kthread.thread.subRows[0].push(slice);
          }
          kthread.openSlice = undefined;

        } else if (eventName == '0') { // trace_mark's show up with 0 prefixes.
          var event = traceEventClockSyncRE.exec(eventBase[5]);
          if (event)
            this.clockSyncRecords_.push({
              perfTS: ts,
              parentTS: event[1] * 1000
            });
          else {
            var tid = this.parsePid(eventBase[1]);
            var tname = this.parseThreadName(eventBase[1]);
            var kpid = tid;

            if (!(kpid in this.threadStateByKPID_))
              this.threadStateByKPID_[kpid] = new ThreadState();
            var state = this.threadStateByKPID_[kpid];

            var event = eventBase[5].split('|')
            switch (event[0]) {
            case 'B':
              var pid = parseInt(event[1]);
              var name = event[2];
              this.processBegin(state, tname, name, ts, pid, tid);
              break;
            case 'E':
              this.processEnd(state, ts);
              break;
            case 'C':
              var pid = parseInt(event[1]);
              var name = event[2];
              var value = parseInt(event[3]);
              this.processCounter(name, ts, value, pid);
              break;
            default:
              this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                  ': Unrecognized event: ' + eventBase[5]);
            }
          }
        }
      }

      // Autoclose any open slices.
      var hasOpenSlices = false;
      for (var kpid in this.threadStateByKPID_) {
        var state = this.threadStateByKPID_[kpid];
        hasOpenSlices |= state.openSlices.length > 0;
      }
      if (hasOpenSlices)
        this.autoCloseOpenSlices();
    }
  };

  tracing.TimelineModel.registerImporter(LinuxPerfImporter);

  return {
    LinuxPerfImporter: LinuxPerfImporter,
    _LinuxPerfImporterTestExports: TestExports
  };

});
