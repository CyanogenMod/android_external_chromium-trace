#!/usr/bin/env python

#
# Copyright 2012, The Android Open Source Project
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

"""Android system-wide tracing utility.

This is a tool for capturing a trace that includes data from both userland and
the kernel.  It creates an HTML file for visualizing the trace.
"""

import errno, optparse, os, select, subprocess, sys, time

def main():
  parser = optparse.OptionParser()
  parser.add_option('-o', dest='output_file', help='write HTML to FILE',
                    default='trace.html', metavar='FILE')
  parser.add_option('-t', '--time', dest='trace_time', type='int',
                    help='trace for N seconds', metavar='N')
  parser.add_option('-b', '--buf-size', dest='trace_buf_size', type='int',
                    help='use a trace buffer size of N KB', metavar='N')
  parser.add_option('-f', '--cpu-freq', dest='trace_cpu_freq', default=False,
                    action='store_true', help='trace CPU frequency changes')
  parser.add_option('-l', '--cpu-load', dest='trace_cpu_load', default=False,
                    action='store_true', help='trace CPU load')
  parser.add_option('-w', '--workqueue', dest='trace_workqueue', default=False,
                    action='store_true', help='trace the kernel workqueues')
  options, args = parser.parse_args()

  atrace_args = ['adb', 'shell', 'atrace', '-s']
  if options.trace_cpu_freq:
    atrace_args.append('-f')
  if options.trace_cpu_load:
    atrace_args.append('-l')
  if options.trace_workqueue:
    atrace_args.append('-w')
  if options.trace_time is not None:
    if options.trace_time > 0:
      atrace_args.extend(['-t', str(options.trace_time)])
    else:
      parser.error('the trace time must be a positive number')
  if options.trace_buf_size is not None:
    if options.trace_buf_size > 0:
      atrace_args.extend(['-b', str(options.trace_buf_size)])
    else:
      parser.error('the trace buffer size must be a positive number')

  html_filename = options.output_file
  html_file = open(html_filename, 'w')
  html_file.write(html_prefix)

  trace_started = False
  leftovers = ''
  adb = subprocess.Popen(atrace_args, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE)
  while True:
    ready = select.select([adb.stdout, adb.stderr], [], [adb.stdout, adb.stderr])
    if adb.stderr in ready[0]:
      err = os.read(adb.stderr.fileno(), 4096)
      sys.stderr.write(err)
      sys.stderr.flush()
    if adb.stdout in ready[0]:
      out = os.read(adb.stdout.fileno(), 4096)
      if not trace_started:
        out = leftovers + out
        lines = out.splitlines(True)
        out, leftovers = '', ''
        for i, line in enumerate(lines):
          if line.replace('\r', '') == 'TRACE:\n':
            sys.stdout.write("downloading trace...")
            sys.stdout.flush()
            out = ''.join(lines[i+1:])
            trace_started = True
            break
          elif 'TRACE:'.startswith(line) and i == len(lines) - 1:
            leftovers = line
          else:
            sys.stdout.write(line)
            sys.stdout.flush()
      html_out = out.replace('\n', '\\n\\\n').replace('\r', '')
      if len(html_out) > 0:
        html_file.write(html_out)
    result = adb.poll()
    if result is not None:
      break
  if result != 0:
    print sys.stderr, 'adb returned error code %d' % result
  else:
    html_file.write(html_suffix)
    html_file.close()
    print " done\n\n    wrote file://%s/%s\n" % (os.getcwd(), options.output_file)

html_prefix = """<!DOCTYPE HTML>
<html>
<head i18n-values="dir:textdirection;">
<title>Android System Trace</title>
<link rel="stylesheet" href="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/timeline.css">
<link rel="stylesheet" href="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/timeline_view.css">
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/shared/js/cr.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/shared/js/cr/event_target.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/shared/js/cr/ui.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/shared/js/util.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/timeline_model.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/linux_perf_importer.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/trace_event_importer.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/sorted_array_utils.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/measuring_stick.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/timeline.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/timeline_track.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/timeline_view.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/fast_rect_renderer.js"></script>
<script src="http://www.corp.google.com/~jgennis/android_tracing/0.1/viewer/test_utils.js"></script>
<style>
  .view {
    overflow: hidden;
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
  }
</style>
</head>
<body>
  <div class="view">
  </div>
  <script>
  var linuxPerfData = "\\
"""

html_suffix = """           dummy-0000  [000] 0.0: 0: trace_event_clock_sync: parent_ts=0.0\\n";
  var timelineViewEl;
  function onLoad() {
    reload();
  }
  function reload() {
    if (!linuxPerfData)
      return;

    var m = new tracing.TimelineModel();
    m.importEvents("[]", true, [linuxPerfData]);

    timelineViewEl = document.querySelector('.view');
    cr.ui.decorate(timelineViewEl, tracing.TimelineView);
    timelineViewEl.model = m;
    timelineViewEl.tabIndex = 1;
    timelineViewEl.timeline.focusElement = timelineViewEl;
  }

  document.addEventListener('DOMContentLoaded', onLoad);
  </script>
</body>
</html>
"""

if __name__ == '__main__':
  main()
