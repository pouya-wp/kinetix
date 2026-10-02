// Compiles host/kinetix.jsx inside ExtendScript and reports syntax errors to scripts/out/ae-check.txt
(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  var f = new File(root + 'host/kinetix.jsx'); f.open('r'); var src = f.read(); f.close();
  var msg;
  try { eval(src); msg = 'OK ' + (typeof KX.textAnalyze); } catch (e) { msg = 'ERROR line ' + e.line + ': ' + e.toString() + '\n>> ' + src.split('\n')[e.line - 1]; }
  var o = new File(root + 'scripts/out/ae-check.txt'); o.open('w'); o.write(msg); o.close();
})();
