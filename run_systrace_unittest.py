#!/usr/bin/env python

# Copyright (c) 2015 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.
import contextlib
import unittest

import systrace


DEVICE_SERIAL = 'AG8404EC0444AGC'
LIST_TMP_ARGS = ['ls', '/data/local/tmp']
ATRACE_ARGS = ['atrace', '-z', '-t', '10']
CATEGORIES = ['sched', 'gfx', 'view', 'wm']
SYSTRACE_CMD = ['./systrace.py', '--time', '10', '-o', 'out.html', '-e',
                DEVICE_SERIAL] + CATEGORIES
TRACE_CMD = (['adb', '-s', DEVICE_SERIAL, 'shell'] + ATRACE_ARGS + CATEGORIES +
             [';', 'ps', '-t'])

TEST_DIR = 'test_data/'
SYSTRACE_DATA = TEST_DIR + 'systrace_data'
SYSTRACE_DATA_RAW = TEST_DIR + 'systrace_data_raw'
SYSTRACE_DATA_STRIPPED = TEST_DIR + 'systrace_data_stripped'
SYSTRACE_DATA_THREAD_FIXED = TEST_DIR + 'systrace_data_thread_fixed'
SYSTRACE_DATA_WITH_THREAD_LIST = TEST_DIR + 'systrace_data_with_thread_list'
SYSTRACE_THREAD_NAMES = TEST_DIR + 'systrace_thread_names'


class SystraceUnitTest(unittest.TestCase):
  def test_construct_adb_shell_command(self):
    command = systrace.construct_adb_shell_command(LIST_TMP_ARGS, None)
    self.assertEqual(' '.join(command), 'adb shell ls /data/local/tmp')

    command = systrace.construct_adb_shell_command(LIST_TMP_ARGS, DEVICE_SERIAL)
    self.assertEqual(' '.join(command),
                     'adb -s AG8404EC0444AGC shell ls /data/local/tmp')

    command = systrace.construct_adb_shell_command(ATRACE_ARGS, DEVICE_SERIAL)
    self.assertEqual(' '.join(command),
                     'adb -s AG8404EC0444AGC shell atrace -z -t 10')

  def test_construct_trace_command(self):
    options, categories = systrace.parse_options(SYSTRACE_CMD)
    tracer_args, expect_trace = systrace.construct_trace_command(options,
                                                                 categories)
    self.assertEqual(' '.join(TRACE_CMD), ' '.join(tracer_args))
    self.assertEqual(True, expect_trace)


  def test_extract_thread_list(self):
    with contextlib.nested(open(SYSTRACE_DATA_WITH_THREAD_LIST, 'r'),
                           open(SYSTRACE_DATA_RAW, 'r'),
                           open(SYSTRACE_THREAD_NAMES, 'r')) as (f1, f2, f3):
      systrace_data_with_thread_list = f1.read()
      systrace_data_raw = f2.read()
      systrace_thread_names = f3.read()

      trace_data, thread_names = systrace.extract_thread_list(
          systrace_data_with_thread_list)
      self.assertEqual(systrace_data_raw, trace_data)
      self.assertEqual(systrace_thread_names, str(thread_names))

  def test_strip_and_decompress_trace(self):
    with contextlib.nested(open(SYSTRACE_DATA_RAW, 'r'),
                           open(SYSTRACE_DATA_STRIPPED, 'r')) as (f1, f2):
      systrace_data_raw = f1.read()
      systrace_data_stripped = f2.read()

      trace_data = systrace.strip_and_decompress_trace(systrace_data_raw)
      self.assertEqual(systrace_data_stripped, trace_data)

  def test_fix_thread_names(self):
    with contextlib.nested(
        open(SYSTRACE_DATA_STRIPPED, 'r'),
        open(SYSTRACE_THREAD_NAMES, 'r'),
        open(SYSTRACE_DATA_THREAD_FIXED, 'r')) as (f1, f2, f3):
      systrace_data_stripped = f1.read()
      systrace_thread_names = f2.read()
      systrace_data_thread_fixed = f3.read()
      thread_names = eval(systrace_thread_names)

      trace_data = systrace.fix_thread_names(
          systrace_data_stripped, thread_names)
      self.assertEqual(systrace_data_thread_fixed, trace_data)

  def test_preprocess_trace_data(self):
    with contextlib.nested(open(SYSTRACE_DATA_WITH_THREAD_LIST, 'r'),
                           open(SYSTRACE_DATA, 'r')) as (f1, f2):
      systrace_data_with_thread_list = f1.read()
      systrace_data = f2.read()

      options, categories = systrace.parse_options([])
      trace_data = systrace.preprocess_trace_data(
          options, systrace_data_with_thread_list)
      self.assertEqual(systrace_data, trace_data)


if __name__ == '__main__':
    unittest.main()
