#!/bin/bash

CSS_FILES="
  www/viewer/timeline.css
  www/viewer/timeline_view.css
"

JS_FILES="
  www/shared/js/cr.js
  www/shared/js/cr/event_target.js
  www/shared/js/cr/ui.js
  www/shared/js/util.js
  www/viewer/timeline_model.js
  www/viewer/linux_perf_importer.js
  www/viewer/trace_event_importer.js
  www/viewer/sorted_array_utils.js
  www/viewer/measuring_stick.js
  www/viewer/timeline.js
  www/viewer/timeline_track.js
  www/viewer/timeline_view.js
  www/viewer/fast_rect_renderer.js
  www/viewer/test_utils.js
"

cat $CSS_FILES | yui-compressor --type css -o style.css
if [ "$?" -ne 0 ]; then
  echo "failed to update style.css"
  exit
else
  echo "updated style.css"
fi

#cat $JS_FILES | yui-compressor --type js -o script.js
cat $JS_FILES > script.js
if [ "$?" -ne 0 ]; then
  echo "failed to update script.js"
  exit
else
  echo "updated script.js"
fi

