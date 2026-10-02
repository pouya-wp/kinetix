// Kinetix integration test, phase 2 (camera, physics, type, animate, style, sfx).
// Run with: AfterFX.exe -r scripts/ae-test2.jsx  → scripts/out/ae-log2.txt
(function () {
  var root = new File($.fileName).parent.parent.absoluteURI + '/';
  $.evalFile(new File(root + 'host/kinetix.jsx'));
  var log = [];
  function write(n, s) { var f = new File(root + 'scripts/out/' + n); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
  function call(name, args) {
    var t0 = new Date().getTime();
    var r = KXJSON.parse(kx_call(name, KXJSON.stringify([args])));
    log.push((r.ok ? 'OK   ' : 'FAIL ') + name + ' (' + (new Date().getTime() - t0) + ' ms) ' + (r.ok ? KXJSON.stringify(r.r).substring(0, 220) : r.err));
    return r.r;
  }
  function check(label, ok, info) { log.push((ok ? 'PASS ' : 'BAD  ') + label + (info ? ' :: ' + info : '')); }
  function sel(comp, layers) { for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false; for (var j = 0; j < layers.length; j++) layers[j].selected = true; }
  function worldCam(comp) {
    var n = comp.layers.addNull(), pc = n.property('ADBE Effect Parade').addProperty('ADBE Point3D Control');
    pc.property(1).expression = 'thisComp.activeCamera.toWorld([0,0,0])';
    var v = pc.property(1).valueAtTime(comp.time, false); n.remove(); return v;
  }
  try {
    // only run in an unsaved project that holds nothing but earlier Kinetix test items
    var ours = function (it) { return it.name.indexOf('KX ') === 0 || it.name === 'Solids' || (it.parentFolder && it.parentFolder.name === 'Solids') || it.name.indexOf('Kinetix') === 0; };
    if (app.project.file && app.project.file.name.indexOf('kx-test') !== 0) { write('ae-log2.txt', 'SKIPPED: a saved project is open - open a new empty project and run again.'); return; }
    for (var q = 1; q <= app.project.numItems; q++) if (!ours(app.project.item(q))) { write('ae-log2.txt', 'SKIPPED: this project has your items (' + app.project.item(q).name + ') - open a new empty project.'); return; }
    for (var q2 = app.project.numItems; q2 >= 1; q2--) { try { if (!(app.project.item(q2) instanceof FolderItem)) app.project.item(q2).remove(); } catch (eR) {} }
    for (var q3 = app.project.numItems; q3 >= 1; q3--) { try { app.project.item(q3).remove(); } catch (eF) {} }
    log.push('AE ' + app.version);
    var comp = app.project.items.addComp('KX Camera Test', 1920, 1080, 1, 10, 30);
    comp.openInViewer();
    var bg = comp.layers.addSolid([0.1, 0.1, 0.15], 'BG', 1920, 1080, 1);
    var a = comp.layers.addSolid([0.8, 1, 0.1], 'Card A', 400, 300, 1);
    var b = comp.layers.addSolid([0.3, 0.8, 1], 'Card B', 400, 300, 1);
    var t = comp.layers.addText('Hello Kinetix');

    // --- camera
    sel(comp, [a, b]);
    call('camRig', { lens: 50, dof: true });
    var sc = call('camScene', {});
    check('rig created', sc && sc.rig && sc.rig.name === 'KX Camera Rig');
    check('layers became 3D', a.threeDLayer && b.threeDLayer && t.threeDLayer);
    check('selection kept after camScene', a.selected && b.selected, 'A ' + a.selected + ' B ' + b.selected);
    var wc = worldCam(comp);
    check('scene camera position matches AE', Math.abs(wc[2] - sc.cam[2]) < 2 && Math.abs(wc[0] - sc.cam[0]) < 2, 'AE ' + wc.join(',') + ' / panel ' + sc.cam.join(','));
    check('default view unchanged (z = -zoom)', Math.abs(wc[2] + 1920 * 50 / 36) < 2, wc[2]);
    comp.time = 0;
    call('camKeys', { ops: [{ target: 'distance', op: 'mul', value: 0.6 }], dur: 2, bezier: [0.33, 0, 0.67, 1], physical: 0, marker: 'Push In' });
    comp.time = 2; var w2 = worldCam(comp);
    check('push-in moves camera closer', Math.abs(w2[2] - (-1920 * 50 / 36 * 0.6)) < 3, w2[2]);
    comp.time = 2;
    call('camKeys', { ops: [{ target: 'orbit', op: 'add', value: 90 }], dur: 2, bezier: [0.33, 0, 0.67, 1], physical: 30, marker: 'Orbit' });
    comp.time = 4; var w3 = worldCam(comp);
    check('orbit 90 swings camera to the side', Math.abs(w3[2]) < 30 && Math.abs(Math.abs(w3[0] - 960) - 1920 * 50 / 36 * 0.6) < 30, w3.join(','));
    sc = call('camScene', {});
    check('scene estimate after orbit', Math.abs(sc.cam[0] - w3[0]) < 5 && Math.abs(sc.cam[2] - w3[2]) < 5, 'panel ' + sc.cam.join(','));
    // director: live pose, key pose, DOF, spread
    comp.time = 5;
    call('camLive', { orbit: 30, tilt: 15, distance: 2000 });
    var pz = call('camPose', {});
    check('live pose applied (auto-key on keyed props)', Math.abs(pz.values.orbit - 30) < 0.01 && Math.abs(pz.values.tilt - 15) < 0.01, KXJSON.stringify(pz.values));
    call('camKeyPose', { bezier: [0.65, 0, 0.25, 1] });
    pz = call('camPose', {});
    var hasKey = false; for (var kk = 0; kk < pz.keys.length; kk++) if (Math.abs(pz.keys[kk] - 5) < 0.02) hasKey = true;
    check('pose keyed at 5s', hasKey, pz.keys.join(','));
    call('camDOF', { on: true, focus: 1800, fstop: 2.8, blur: 150, iris: 7 });
    pz = call('camPose', {});
    check('DOF settings', pz.dof.on && Math.abs(pz.dof.focus - 1800) < 0.5, KXJSON.stringify(pz.dof));
    sel(comp, [a, b]);
    call('camSpread', { factor: 1.5 });
    sel(comp, [a, b]);
    call('camLayout', { items: [{ index: a.index, pos: [700, 540, 500] }, { index: b.index, pos: [1200, 540, -300] }] });
    check('layout wrote z', Math.abs(a.property('ADBE Transform Group').property('ADBE Position').value[2] - 500) < 0.1);
    sel(comp, [a]);
    call('camFocus', { mode: 'auto', layers: ['Card A'], fstop: 2.8, blur: 100 });
    call('camShake', { pos: '[0,0,0]', rx: 'value', ry: 'value', rz: 'value', amount: 100, speed: 100, seed: 1 });
    sel(comp, [a, b]); comp.time = 4;
    call('camFrame', { margin: 1.15 });
    sel(comp, [a, b]);
    call('camTour', { hold: 1, travel: 1, orbit: 10 });
    call('camMotionBlur', { on: true, angle: 180 });
    call('camBake', {});

    // --- physics with a morphing shape layer
    var pcomp = app.project.items.addComp('KX Physics Test', 1920, 1080, 1, 6, 30);
    pcomp.openInViewer();
    var sh = pcomp.layers.addShape(); sh.name = 'Morphing Star';
    var grp = sh.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var star = grp.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Star');
    star.property('ADBE Vector Star Outer Radius').setValueAtTime(0, 150);
    star.property('ADBE Vector Star Outer Radius').setValueAtTime(2, 60);
    grp.property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Fill');
    sh.property('ADBE Transform Group').property('ADBE Position').setValue([960, 300]);
    sel(pcomp, [sh]); pcomp.time = 0;
    var ps = call('physScene2', { duration: 4 });
    check('outline sampled per frame (morphing)', ps.layers[0].morphing === true && ps.layers[0].outlines.length > 100, ps.layers[0].outlines.length + ' frames');
    check('outline has star points', ps.layers[0].outlines[0][0].length === 10, ps.layers[0].outlines[0][0].length + ' pts');

    // --- type, animate, ease, style, gradient
    comp.openInViewer();
    sel(comp, [t]);
    call('typeApply', { animators: [{ name: 'KX Type In', basedOn: 2, props: { opacity: 0, pos: [0, 40, 0] }, amount: '[50,50,50]' }], controls: [{ name: 'KX Type In Duration', value: 0.5 }], threeD: false, grouping: 1 });
    sel(comp, [b]);
    call('animApply', { needs3D: false, controls: [{ name: 'KX In Duration', value: 0.5 }, { name: 'KX Out Duration', value: 0.5 }, { name: 'KX Strength', value: 100 }], props: [{ key: 'opacity', expr: '// KX-ANIM\nvalue;' }], fx: [{ match: 'ADBE Box Blur2', name: 'KX Blur', set: { 'Iterations': 3 }, expr: { 'Blur Radius': '// KX-ANIM\n0;' } }] });
    var op = b.property('ADBE Transform Group').property('ADBE Opacity');
    op.setValueAtTime(0, 0); op.setValueAtTime(1, 100);
    op.expression = '';
    op.selected = true; op.setSelectedAtKey(1, true); op.setSelectedAtKey(2, true);
    call('easeApplyKeys', { bezier: [0.3, 0, 0.2, 1.4] });
    sel(comp, [a]);
    call('styleApply', { fx: [{ match: ['Deep Glow 2', 'ADBE Glo2'], name: 'KX Style Glow', props: { 'Glow Radius': 30 } }], text: null, extrude: 0, clear: true, name: 'Neon' });
    call('gradApply', { mode: 'fill', png: null, name: 'Test', stops: [[1, 0, 0, 1], [0, 0, 1, 1]], radial: false, angle: 90, animate: false });
    comp.openInViewer();
    var ev = call('sfxScan', { markers: true, keys: true, inout: true, scope: 'all' });
    check('auto-sfx finds camera move markers', ev && ev.length > 0, ev ? ev.length + ' events' : '');

    app.project.save(new File(root + 'scripts/out/kx-test-phase2.aep'));
    log.push('saved project');
  } catch (e) { log.push('CRASH ' + e.toString() + ' line ' + e.line); }
  write('ae-log2.txt', log.join('\n'));
})();
