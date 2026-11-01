(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  var out = [];
  try {
    out.push('project items: ' + app.project.numItems + ' file: ' + (app.project.file ? app.project.file.name : 'untitled'));
    var all = app.fonts.allFonts;
    for (var i = 0; i < all.length; i++) for (var j = 0; j < all[i].length; j++) {
      var f = all[i][j];
      if (/clash|fragment|inter|cascadia|ubuntu/i.test(f.familyName)) out.push(f.familyName + ' | ' + f.styleName + ' | ' + f.postScriptName);
    }
  } catch (e) { out.push('ERR ' + e.message); }
  var fl = new File(root + 'scripts/out/fonts.txt'); fl.encoding = 'UTF-8'; fl.open('w'); fl.write(out.join('\n')); fl.close();
})();
