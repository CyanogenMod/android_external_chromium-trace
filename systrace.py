#!/usr/bin/env python

# Copyright (c) 2011 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

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

  script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
  css_filename = os.path.join(script_dir, 'style.css')
  js_filename = os.path.join(script_dir, 'script.js')
  css = open(css_filename).read()
  js = open(js_filename).read()

  html_filename = options.output_file
  html_file = open(html_filename, 'w')
  html_file.write(html_prefix % (css, js))

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
<style type="text/css">%s</style>
<script language="javascript">%s</script>
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
