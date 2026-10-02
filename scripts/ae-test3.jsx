// Kinetix integration test, phase 3 (Auto-SFX v3 sampling, bake, camera drag undo, mix placement).
// Run with: AfterFX.exe -r scripts/ae-test3.jsx  -> scripts/out/ae-log3.txt
// Only runs in an unsaved project that holds nothing but Kinetix test items.
(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  $.evalFile(new File(root + 'host/kinetix.jsx'));
  var log = [];
  function write(n, s) { var f = new File(root + 'scripts/out/' + n); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
  function call(name, args) {
    var t0 = new Date().getTime();
    var r = KXJSON.parse(kx_call(name, KXJSON.stringify([args])));
    log.push((r.ok ? 'OK   ' : 'FAIL ') + name + ' (' + (new Date().getTime() - t0) + ' ms) ' + (r.ok ? KXJSON.stringify(r.r).substring(0, 200) : r.err));
    return r.r;
  }
  function check(label, ok, info) { log.push((ok ? 'PASS ' : 'BAD  ') + label + (info ? ' :: ' + info : '')); }
  try {
    var ours = function (it) { return it.name.indexOf('KX ') === 0 || it.name === 'Solids' || (it.parentFolder && it.parentFolder.name === 'Solids') || it.name.indexOf('Kinetix') === 0; };
    if (app.project.file && app.project.file.name.indexOf('kx-test') !== 0) { write('ae-log3.txt', 'SKIPPED: a saved project is open - open a new empty project and run again.'); return; }
    for (var q = 1; q <= app.project.numItems; q++) if (!ours(app.project.item(q))) { write('ae-log3.txt', 'SKIPPED: this project has your items (' + app.project.item(q).name + ') - open a new empty project.'); return; }
    for (var q2 = app.project.numItems; q2 >= 1; q2--) { try { if (!(app.project.item(q2) instanceof FolderItem)) app.project.item(q2).remove(); } catch (eR) {} }
    for (var q3 = app.project.numItems; q3 >= 1; q3--) { try { app.project.item(q3).remove(); } catch (eF) {} }
    log.push('AE ' + app.version);

    var comp = app.project.items.addComp('KX SFX Test', 1920, 1080, 1, 4, 30);
    comp.openInViewer();
    // a parented, scaled ball that drops and lands (motion lives on the PARENT)
    var par = comp.layers.addNull(); par.name = 'KX Parent';
    var ball = comp.layers.addSolid([1, 0.8, 0.2], 'KX Ball', 120, 120, 1);
    ball.parent = par;
    var pp = par.property('ADBE Transform Group').property('ADBE Position');
    pp.setValueAtTime(0, [960, 100]); pp.setValueAtTime(1, [960, 900]);
    pp.setTemporalEaseAtKey(1, [new KeyframeEase(0, 33)], [new KeyframeEase(0, 75)]);
    pp.setTemporalEaseAtKey(2, [new KeyframeEase(1800, 10)], [new KeyframeEase(0, 33)]);
    // a precomp whose inner card pops in at 2 s
    var inner = app.project.items.addComp('KX Inner', 1920, 1080, 1, 4, 30);
    var card = inner.layers.addSolid([0.3, 0.8, 1], 'KX Card', 300, 200, 1);
    var cs = card.property('ADBE Transform Group').property('ADBE Scale');
    cs.setValueAtTime(2, [0, 0]); cs.setValueAtTime(2.3, [110, 110]); cs.setValueAtTime(2.45, [100, 100]);
    comp.layers.add(inner);
    // In/Out with an expression (sampled through toComp too)
    var t = comp.layers.addText('KX Title');
    t.selected = true; ball.selected = false;
    call('animApply', { props: [{ key: 'opacity', expr: '// KX-ANIM\nvar d=0.4;value*Math.min(1,Math.max(0,(time-inPoint)/d));' }], controls: [{ name: 'KX In Duration', value: 0.4 }], fx: [], needs3D: false });

    var S = call('sfxSample3', { scope: 'all', workArea: false, precomps: true });
    check('sampled layers', S && S.layers.length >= 4, S ? S.layers.length + ' tracks' : 'none');
    var names = []; for (var i = 0; i < S.layers.length; i++) names.push(S.layers[i].name);
    check('precomp content sampled', names.join('|').indexOf('KX Inner > KX Card') >= 0, names.join(', '));
    var B = null; for (var j = 0; j < S.layers.length; j++) if (S.layers[j].name === 'KX Ball') B = S.layers[j];
    check('parent motion visible on child', B && B.y[0] < 200 && B.y[30] > 850, B ? B.y[0] + ' -> ' + B.y[30] : 'missing');
    check('probe removed', comp.layer(1).name !== 'KX SFX probe' && comp.numLayers === 4, comp.numLayers + ' layers');
    check('selection kept', t.selected === true);
    var T = null; for (var k = 0; k < S.layers.length; k++) if (S.layers[k].name === 'KX Title') T = S.layers[k];
    check('In/Out info read', T && T.inout && Math.abs(T.inout.inDur - 0.4) < 1e-6);

    // bake
    var bk = call('bakeKX', { all: true });
    var op = t.property('ADBE Transform Group').property('ADBE Opacity');
    check('bake wrote keys', bk && bk.props >= 1 && op.numKeys >= 2 && op.expression === '', bk ? bk.props + ' props, ' + op.numKeys + ' keys' : '');

    // camera: drag-scoped undo group calls must not throw
    call('camRig', { lens: 50, dof: false, make3D: true });
    call('camLiveBegin', {});
    call('camLive', { orbit: 10 });
    call('camLive', { orbit: 20 });
    call('camLiveEnd', {});
    check('live drag closed', KX._liveOpen === false);

    // mix placement (a 1 s silent wav)
    var wav = new File(Folder.temp.fsName + '/kx-test-mix.wav');
    wav.encoding = 'BINARY'; wav.open('w');
    var n = 48000, data = n * 2;
    var u32 = function (v) { return String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); };
    var u16 = function (v) { return String.fromCharCode(v & 255, (v >> 8) & 255); };
    wav.write('RIFF' + u32(36 + data) + 'WAVEfmt ' + u32(16) + u16(1) + u16(1) + u32(48000) + u32(96000) + u16(2) + u16(16) + 'data' + u32(data));
    var z = ''; for (var b = 0; b < 4800; b++) z += '\u0000\u0000';
    for (var c = 0; c < 10; c++) wav.write(z);
    wav.close();
    var r1 = call('sfxPlaceMix', { files: [{ path: wav.fsName, t: 0, name: 'KX Auto-SFX test' }], replace: true });
    var r2 = call('sfxPlaceMix', { files: [{ path: wav.fsName, t: 0, name: 'KX Auto-SFX test' }], replace: true });
    var mixes = 0; for (var m = 1; m <= comp.numLayers; m++) if (comp.layer(m).comment === 'kx-sfx-mix') mixes++;
    check('mix replaced, not stacked', r1 && r2 && mixes === 1, mixes + ' mix layer(s)');
  } catch (e) {
    log.push('ERROR ' + e.message + ' line ' + e.line);
  }
  write('ae-log3.txt', log.join('\n'));
})();
