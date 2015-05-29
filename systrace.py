#!/usr/bin/env python

# Copyright (c) 2011 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

"""Android system-wide tracing utility.

This is a tool for capturing a trace that includes data from both userland and
the kernel.  It creates an HTML file for visualizing the trace.
"""

import sys

# Make sure we're using a new enough version of Python.
# The flags= parameter of re.sub() is new in Python 2.7.
if sys.version_info[:2] < (2, 7):
  print >> sys.stderr, '\nThis script requires Python 2.7 or newer.'
  sys.exit(1)

# pylint: disable=g-bad-import-order,g-import-not-at-top
import optparse
import os
import re
import select
import subprocess
import time
import zlib

# The adb shell command to initiate a trace.
ATRACE_BASE_ARGS = ['atrace']
# If a custom list of categories is not specified, traces will include
# these categories (if available on the device).
DEFAULT_CATEGORIES = 'sched gfx view dalvik webview input disk am wm'.split()
# The command to list trace categories.
LIST_CATEGORIES_ARGS = ATRACE_BASE_ARGS + ['--list_categories']
# Plain-text trace data should always start with this string.
TRACE_TEXT_HEADER = '# tracer'


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


def add_adb_serial(adb_command, device_serial):
  if device_serial is not None:
    adb_command.insert(1, device_serial)
    adb_command.insert(1, '-s')


def construct_adb_shell_command(shell_args, device_serial):
  adb_command = ['adb', 'shell', ' '.join(shell_args)]
  add_adb_serial(adb_command, device_serial)
  return adb_command


def run_adb_shell(shell_args, device_serial):
  """Runs "adb shell" with the given arguments.

  Args:
    shell_args: array of arguments to pass to adb shell.
    device_serial: if not empty, will add the appropriate command-line
        parameters so that adb targets the given device.
  Returns:
    A tuple containing the adb output (stdout & stderr) and the return code
    from adb.  Will exit if adb fails to start.
  """
  adb_command = construct_adb_shell_command(shell_args, device_serial)

  adb_output = []
  adb_return_code = 0
  try:
    adb_output = subprocess.check_output(adb_command, stderr=subprocess.STDOUT,
                                         shell=False, universal_newlines=True)
  except OSError as error:
    # This usually means that the adb executable was not found in the path.
    print >> sys.stderr, ('\nThe command "%s" failed with the following error:'
                          % ' '.join(adb_command))
    print >> sys.stderr, '    %s\n' % str(error)
    print >> sys.stderr, 'Is adb in your path?'
    sys.exit(1)
  except subprocess.CalledProcessError as error:
    # The process exited with an error.
    adb_return_code = error.returncode
    adb_output = error.output

  return (adb_output, adb_return_code)


def get_device_sdk_version():
  """Uses adb to attempt to determine the SDK version of a running device."""

  getprop_args = ['getprop', 'ro.build.version.sdk']

  # get_device_sdk_version() is called before we even parse our command-line
  # args.  Therefore, parse just the device serial number part of the
  # command-line so we can send the adb command to the correct device.
  parser = OptionParserIgnoreErrors()
  parser.add_option('-e', '--serial', dest='device_serial', type='string')
  options, unused_args = parser.parse_args()

  success = False

  adb_output, adb_return_code = run_adb_shell(getprop_args,
                                              options.device_serial)

  if adb_return_code == 0:
    # ADB may print output other than the version number (e.g. it chould
    # print a message about starting the ADB server).
    # Break the ADB output into white-space delimited segments.
    parsed_output = str.split(adb_output)
    if parsed_output:
      # Assume that the version number is the last thing printed by ADB.
      version_string = parsed_output[-1]
      if version_string:
        try:
          # Try to convert the text into an integer.
          version = int(version_string)
        except ValueError:
          version = -1
        else:
          success = True

  if not success:
    print >> sys.stderr, (
        '\nThe command "%s" failed with the following message:'
        % ' '.join(getprop_args))
    print >> sys.stderr, adb_output
    sys.exit(1)

  return version


def get_default_categories(device_serial):
  categories_output, return_code = run_adb_shell(LIST_CATEGORIES_ARGS,
                                                 device_serial)

  if return_code == 0 and categories_output:
    categories = [c.split('-')[0].strip()
                  for c in categories_output.splitlines()]
    return [c for c in categories if c in DEFAULT_CATEGORIES]

  return []


def parse_options():
  """Parses and checks the command-line options.

  Returns:
    A tuple containing the options structure and a list of categories to
    be traced.
  """
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
  parser.add_option('--no-compress', dest='compress_trace_data',
                    default=True, action='store_false',
                    help='Tell the device not to send the trace data in '
                    'compressed form.')
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

  if (options.trace_time is not None) and (options.trace_time <= 0):
    parser.error('the trace time must be a positive number')

  if (options.trace_buf_size is not None) and (options.trace_buf_size <= 0):
    parser.error('the trace buffer size must be a positive number')

  return (options, categories)


def construct_trace_command(options, categories):
  """Builds a command-line used to invoke a trace process.

  Args:
    options: The command-line options.
    categories: The trace categories to capture.
  Returns:
    A tuple where the first element is an array of command-line arguments, and
    the second element is a boolean which will be true if the commend will
    stream trace data.
  """
  if options.list_categories:
    tracer_args = construct_adb_shell_command(LIST_CATEGORIES_ARGS,
                                              options.device_serial)
    expect_trace = False
  elif options.from_file is not None:
    tracer_args = ['cat', options.from_file]
    expect_trace = True
  else:
    atrace_args = ATRACE_BASE_ARGS
    expect_trace = True
    if options.compress_trace_data:
      atrace_args.extend(['-z'])

    if (options.trace_time is not None) and (options.trace_time > 0):
      atrace_args.extend(['-t', str(options.trace_time)])

    if (options.trace_buf_size is not None) and (options.trace_buf_size > 0):
      atrace_args.extend(['-b', str(options.trace_buf_size)])

    if options.app_name is not None:
      atrace_args.extend(['-a', options.app_name])

    if options.kfuncs is not None:
      atrace_args.extend(['-k', options.kfuncs])

    if not categories:
      categories = get_default_categories(options.device_serial)
    atrace_args.extend(categories)

    if options.fix_threads:
      atrace_args.extend([';', 'ps', '-t'])
    tracer_args = construct_adb_shell_command(atrace_args,
                                              options.device_serial)

  return (tracer_args, expect_trace)


def collect_trace_data(tracer_args):
  """Invokes and communicates with the trace process.

  Args:
    tracer_args: The command-line to execute.
  Returns:
    The captured trace data.
  """
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

  if result != 0:
    print >> sys.stderr, 'adb returned error code %d' % result
    sys.exit(1)

  return data


def extract_thread_list(trace_data):
  threads = {}
  parts = re.split('USER +PID +PPID +VSIZE +RSS +WCHAN +PC +NAME',
                   trace_data, 1)
  if len(parts) == 2:
    trace_data = parts[0]
    for line in parts[1].splitlines():
      cols = line.split(None, 8)
      if len(cols) == 9:
        tid = int(cols[1])
        name = cols[8]
        threads[tid] = name

  return (trace_data, threads)


def strip_and_decompress_trace(data, fix_threads):
  # Collapse CRLFs that are added by adb shell.
  if data.startswith('\r\n'):
    data = data.replace('\r\n', '\n')

  # Skip the initial newline.
  data = data[1:]

  if not data:
    print >> sys.stderr, ('No data was captured.  Output file was not '
                          'written.')
    sys.exit(1)

  # Indicate to the user that the data download is complete.
  print ' done\n'

  # Extract the thread list dumped by ps.
  threads = {}
  if fix_threads:
    data, threads = extract_thread_list(data)

  if data.startswith(TRACE_TEXT_HEADER):
    # Plain-text data.
    out = data
  else:
    # No header found, so assume the data is compressed.
    out = zlib.decompress(data)
  return (out, threads)


def fix_thread_names(trace_data, thread_names):
  def repl(m):
    tid = int(m.group(2))
    if tid > 0:
      name = thread_names.get(tid)
      if name is None:
        name = m.group(1)
        if name == '<...>':
          name = '<' + str(tid) + '>'
        thread_names[tid] = name
      return name + '-' + m.group(2)
    else:
      return m.group(0)
  trace_data = re.sub(r'^\s*(\S+)-(\d+)', repl, trace_data,
                      flags=re.MULTILINE)
  return trace_data


def preprocess_trace_data(options, trace_data):
  trace_data = ''.join(trace_data)

  trace_data, thread_names = strip_and_decompress_trace(trace_data,
                                                        options.fix_threads)

  if not trace_data:
    print >> sys.stderr, ('No data was captured.  Output file was not '
                          'written.')
    sys.exit(1)

  if options.fix_threads:
    trace_data = fix_thread_names(trace_data, thread_names)

  if options.fix_circular:
    trace_data = fix_circular_traces(trace_data)

  return trace_data


def write_trace_html(html_filename, script_dir, trace_data):
  html_prefix = read_asset(script_dir, 'prefix.html')
  html_suffix = read_asset(script_dir, 'suffix.html')
  trace_viewer_html = read_asset(script_dir, 'systrace_trace_viewer.html')

  # Open the file in binary mode to prevent python from changing the
  # line endings.
  html_file = open(html_filename, 'wb')
  html_file.write(html_prefix.replace('{{SYSTRACE_TRACE_VIEWER_HTML}}',
                                      trace_viewer_html))

  html_file.write('<!-- BEGIN TRACE -->\n'
                  '  <script class="trace-data" type="application/text">\n')
  html_file.write(trace_data)
  html_file.write('  </script>\n<!-- END TRACE -->\n')

  html_file.write(html_suffix)
  html_file.close()
  print '\n    wrote file://%s\n' % os.path.abspath(html_filename)


def main():
  device_sdk_version = get_device_sdk_version()
  if device_sdk_version < 18:
    legacy_script = os.path.join(os.path.dirname(sys.argv[0]),
                                 'systrace-legacy.py')
    # execv() does not return.
    os.execv(legacy_script, sys.argv)

  options, categories = parse_options()
  tracer_args, expect_trace = construct_trace_command(options, categories)

  trace_data = collect_trace_data(tracer_args)

  if not expect_trace:
    # Nothing more to do.
    return

  trace_data = preprocess_trace_data(options, trace_data)

  script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
  write_trace_html(options.output_file, script_dir, trace_data)


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
