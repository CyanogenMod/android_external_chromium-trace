#!/usr/bin/python

import httplib, urllib, subprocess, sys

js_in_files = (
  'src/shared/js/cr.js',
  'src/shared/js/cr/event_target.js',
  'src/shared/js/cr/ui.js',
  'src/shared/js/cr/ui/focus_outline_manager.js',
  'src/shared/js/cr/ui/tabs.js',
  'src/shared/js/util.js',
  'src/tracing/overlay.js',
  'src/tracing/tracing_controller.js',
  'src/tracing/timeline_model.js',
  'src/tracing/linux_perf_importer.js',
  'src/tracing/trace_event_importer.js',
  'src/tracing/sorted_array_utils.js',
  'src/tracing/measuring_stick.js',
  'src/tracing/timeline.js',
  'src/tracing/timeline_analysis.js',
  'src/tracing/timeline_track.js',
  'src/tracing/fast_rect_renderer.js',
  'src/tracing/profiling_view.js',
  'src/tracing/timeline_view.js',
)

css_in_files = (
  'src/shared/css/tabs.css',
  'src/shared/css/widgets.css',
  'src/tracing/overlay.css',
  'src/tracing/profiling_view.css',
  'src/tracing/timeline_analysis.css',
  'src/tracing/timeline_view.css',
  'src/tracing/timeline.css',
  'src/tracing/tracing_controller.css',
)

js_out_file = 'script.js'

css_out_file = 'style.css'

# Read all the Javascript files.
js_code = [('js_code', open(f).read()) for f in js_in_files]

# Read all the CSS files and concatenate them.
css_code = ''.join(open(f).read() for f in css_in_files)

# Define the parameters for the POST request and encode them in
# a URL-safe format.
params = urllib.urlencode(js_code + [
  ('language', 'ECMASCRIPT5'),
  ('compilation_level', 'SIMPLE_OPTIMIZATIONS'),
  ('output_format', 'text'),
  ('output_info', 'compiled_code'),
])

# Always use the following value for the Content-type header.
headers = { "Content-type": "application/x-www-form-urlencoded" }
conn = httplib.HTTPConnection('closure-compiler.appspot.com')
conn.request('POST', '/compile', params, headers)
response = conn.getresponse()
data = response.read()
conn.close

if response.status != 200:
  print sys.stderr, "error returned from JS compile service: %d" % response.status
  sys.exit(1)

open(js_out_file, 'wt').write(data)
print 'Generated %s.  Check the file to see if errors occured!' % js_out_file

yuic_args = ['yui-compressor', '--type', 'css', '-o', css_out_file]
p = subprocess.Popen(yuic_args, stdin=subprocess.PIPE)
p.communicate(input=css_code)
if p.wait() != 0:
  print 'Failed to generate %s.' % css_out_file
  sys.exit(1)

print 'Generated %s.' % css_out_file
