#!/usr/bin/env python

# Copyright (c) 2011 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

"""Android system-wide tracing utility.

This is a tool for capturing a trace that includes data from both userland and
the kernel.  It creates an HTML file for visualizing the trace.
"""


import optparse
import os
import re
import select
import subprocess
import sys
import time
import zlib

# If a custom list of categories is not specified, traces will include
# these categories (if available on the device).
DEFAULT_CATEGORIES = 'sched gfx view dalvik webview input disk am wm'.split()


class OptionParserIgnoreErrors(optparse.OptionParser):
  """Wrapper for OptionParser that ignores errors and produces no output."""

  def error(self, msg):
    pass

  def exit(self):
    pass

  def print_usage(self):
    pass

  def print_help(self):
    pass

  def print_version(self):
    pass


def get_device_sdk_version():
  """Uses adb to attempt to determine the SDK version of a running device."""

  getprop_args = ['adb', 'shell', 'getprop', 'ro.build.version.sdk']

  # get_device_sdk_version() is called before we even parse our command-line
  # args.  Therefore, parse just the device serial number part of the
  # command-line so we can send the adb command to the correct device.
  parser = OptionParserIgnoreErrors()
  parser.add_option('-e', '--serial', dest='device_serial', type='string')
  options, unused_args = parser.parse_args()
  if options.device_serial is not None:
    getprop_args[1:1] = ['-s', options.device_serial]

  try:
    adb = subprocess.Popen(getprop_args, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE)
  except OSError:
    print 'Missing adb?'
    sys.exit(1)
  out, err = adb.communicate()
  if adb.returncode != 0:
    print >> sys.stderr, 'Error querying device SDK-version:'
    print >> sys.stderr, err
    sys.exit(1)

  version = int(out)
  return version


def add_adb_serial(command, serial):
  if serial is not None:
    command.insert(1, serial)
    command.insert(1, '-s')


def get_default_categories():
  list_command = ['adb', 'shell', 'atrace', '--list_categories']
  try:
    categories_output = subprocess.check_output(list_command)
    categories = [c.split('-')[0].strip()
                  for c in categories_output.splitlines()]
    return [c for c in categories if c in DEFAULT_CATEGORIES]
  except:
    return []


def main():
  device_sdk_version = get_device_sdk_version()
  if device_sdk_version < 18:
    legacy_script = os.path.join(os.path.dirname(sys.argv[0]),
                                 'systrace-legacy.py')
    os.execv(legacy_script, sys.argv)

  usage = 'Usage: %prog [options] [category1 [category2 ...]]'
  desc = 'Example: %prog -b 32768 -t 15 gfx input view sched freq'
  parser = optparse.OptionParser(usage=usage, description=desc)
  parser.add_option('-o', dest='output_file', help='write HTML to FILE',
                    default='trace.html', metavar='FILE')
  parser.add_option('-t', '--time', dest='trace_time', type='int',
                    help='trace for N seconds', metavar='N')
  parser.add_option('-b', '--buf-size', dest='trace_buf_size', type='int',
                    help='use a trace buffer size of N KB', metavar='N')
  parser.add_option('-k', '--ktrace', dest='kfuncs', action='store',
                    help='specify a comma-separated list of kernel functions '
                    'to trace')
  parser.add_option('-l', '--list-categories', dest='list_categories',
                    default=False, action='store_true',
                    help='list the available categories and exit')
  parser.add_option('-a', '--app', dest='app_name', default=None, type='string',
                    action='store',
                    help='enable application-level tracing for comma-separated '
                    'list of app cmdlines')
  parser.add_option('--no-fix-threads', dest='fix_threads', default=True,
                    action='store_false',
                    help='don\'t fix missing or truncated thread names')
  parser.add_option('--no-fix-circular', dest='fix_circular', default=True,
                    action='store_false',
                    help='don\'t fix truncated circular traces')
  parser.add_option('--link-assets', dest='link_assets', default=False,
                    action='store_true',
                    help='(deprecated)')
  parser.add_option('--from-file', dest='from_file', action='store',
                    help='read the trace from a file (compressed) rather than '
                    'running a live trace')
  parser.add_option('--asset-dir', dest='asset_dir', default='trace-viewer',
                    type='string', help='(deprecated)')
  parser.add_option('-e', '--serial', dest='device_serial', type='string',
                    help='adb device serial number')

  options, categories = parser.parse_args()

  if options.link_assets or options.asset_dir != 'trace-viewer':
    parser.error('--link-assets and --asset-dir are deprecated.')

  if options.list_categories:
    tracer_args = ['adb', 'shell', 'atrace --list_categories']
    expect_trace = False
  elif options.from_file is not None:
    tracer_args = ['cat', options.from_file]
    expect_trace = True
  else:
    atrace_args = ['atrace', '-z']
    expect_trace = True

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

    if options.app_name is not None:
      atrace_args.extend(['-a', options.app_name])

    if options.kfuncs is not None:
      atrace_args.extend(['-k', options.kfuncs])

    if not categories:
      categories = get_default_categories()
    atrace_args.extend(categories)

    if options.fix_threads:
      atrace_args.extend([';', 'ps', '-t'])
    tracer_args = ['adb', 'shell', ' '.join(atrace_args)]

  if tracer_args[0] == 'adb':
    add_adb_serial(tracer_args, options.device_serial)

  script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))

  html_filename = options.output_file

  adb = subprocess.Popen(tracer_args, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE)

  result = None
  data = []

  # Read the text portion of the output and watch for the 'TRACE:' marker that
  # indicates the start of the trace data.
  while result is None:
    ready = select.select([adb.stdout, adb.stderr], [],
                          [adb.stdout, adb.stderr])
    if adb.stderr in ready[0]:
      err = os.read(adb.stderr.fileno(), 4096)
      sys.stderr.write(err)
      sys.stderr.flush()
    if adb.stdout in ready[0]:
      out = os.read(adb.stdout.fileno(), 4096)
      parts = out.split('\nTRACE:', 1)

      txt = parts[0].replace('\r', '')
      if len(parts) == 2:
        # The '\nTRACE:' match stole the last newline from the text, so add it
        # back here.
        txt += '\n'
      sys.stdout.write(txt)
      sys.stdout.flush()

      if len(parts) == 2:
        data.append(parts[1])
        sys.stdout.write('downloading trace...')
        sys.stdout.flush()
        break

    result = adb.poll()

  # Read and buffer the data portion of the output.
  while True:
    ready = select.select([adb.stdout, adb.stderr], [],
                          [adb.stdout, adb.stderr])
    keepReading = False
    if adb.stderr in ready[0]:
      err = os.read(adb.stderr.fileno(), 4096)
      if len(err) > 0:
        keepReading = True
        sys.stderr.write(err)
        sys.stderr.flush()
    if adb.stdout in ready[0]:
      out = os.read(adb.stdout.fileno(), 4096)
      if len(out) > 0:
        keepReading = True
        data.append(out)

    if result is not None and not keepReading:
      break

    result = adb.poll()

  if result == 0:
    if expect_trace:
      data = ''.join(data)

      # Collapse CRLFs that are added by adb shell.
      if data.startswith('\r\n'):
        data = data.replace('\r\n', '\n')

      # Skip the initial newline.
      data = data[1:]

      if not data:
        print >> sys.stderr, ('No data was captured.  Output file was not '
                              'written.')
        sys.exit(1)
      else:
        # Indicate to the user that the data download is complete.
        print ' done\n'

      # Extract the thread list dumped by ps.
      threads = {}
      if options.fix_threads:
        parts = re.split('USER +PID +PPID +VSIZE +RSS +WCHAN +PC +NAME',
                         data, 1)
        if len(parts) == 2:
          data = parts[0]
          for line in parts[1].splitlines():
            cols = line.split(None, 8)
            if len(cols) == 9:
              tid = int(cols[1])
              name = cols[8]
              threads[tid] = name

      # Decompress and preprocess the data.
      out = zlib.decompress(data)
      if options.fix_threads:
        def repl(m):
          tid = int(m.group(2))
          if tid > 0:
            name = threads.get(tid)
            if name is None:
              name = m.group(1)
              if name == '<...>':
                name = '<' + str(tid) + '>'
              threads[tid] = name
            return name + '-' + m.group(2)
          else:
            return m.group(0)
        out = re.sub(r'^\s*(\S+)-(\d+)', repl, out, flags=re.MULTILINE)

      if options.fix_circular:
        out = fix_circular_traces(out)

      html_prefix = read_asset(script_dir, 'prefix.html')
      html_suffix = read_asset(script_dir, 'suffix.html')
      trace_viewer_html = read_asset(script_dir, 'systrace_trace_viewer.html')

      html_file = open(html_filename, 'w')
      html_file.write(html_prefix.replace('{{SYSTRACE_TRACE_VIEWER_HTML}}',
                                          trace_viewer_html))

      html_file.write('<!-- BEGIN TRACE -->\n'
                      '  <script class="trace-data" type="application/text">\n')
      html_file.write(out)
      html_file.write('  </script>\n<!-- END TRACE -->\n')

      html_file.write(html_suffix)
      html_file.close()
      print '\n    wrote file://%s\n' % os.path.abspath(options.output_file)

  else:  # i.e. result != 0
    print >> sys.stderr, 'adb returned error code %d' % result
    sys.exit(1)


def read_asset(src_dir, filename):
  return open(os.path.join(src_dir, filename)).read()


def fix_circular_traces(out):
  """Fix inconsistentcies in traces due to circular buffering.

  The circular buffers are kept per CPU, so it is not guaranteed that the
  beginning of a slice is overwritten before the end. To work around this, we
  throw away the prefix of the trace where not all CPUs have events yet.

  Args:
    out: The data to fix.
  Returns:
    The updated trace data.
  """
  # If any of the CPU's buffers have filled up and
  # older events have been dropped, the kernel
  # emits markers of the form '##### CPU 2 buffer started ####' on
  # the line before the first event in the trace on that CPU.
  #
  # No such headers are emitted if there were no overflows or the trace
  # was captured with non-circular buffers.
  buffer_start_re = re.compile(r'^#+ CPU \d+ buffer started', re.MULTILINE)

  start_of_full_trace = 0

  while True:
    result = buffer_start_re.search(out, start_of_full_trace + 1)
    if result:
      start_of_full_trace = result.start()
    else:
      break

  if start_of_full_trace > 0:
    # Need to keep the header intact to make the importer happy.
    end_of_header = re.search(r'^[^#]', out, re.MULTILINE).start()
    out = out[:end_of_header] + out[start_of_full_trace:]
  return out

if __name__ == '__main__':
  main()
