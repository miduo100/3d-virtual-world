/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 动画相关功能

// 去除动画Clip的根骨骼位移（Root Motion消除）
function _extractTrackNodeName(trackName) {
  if (!trackName) return '';
  // 常见：mixamorigHips.quaternion / Hips.position
  let head = trackName.split('.')[0] || '';
  // 兼容：bones[mixamorigHips].quaternion
  const m = head.match(/bones\[(.+?)\]/);
  if (m && m[1]) head = m[1];
  return head;
}

function _nodeDepth(node, stopAt) {
  let d = 0;
  let cur = node;
  while (cur && cur !== stopAt) {
    cur = cur.parent;
    d++;
    if (d > 200) break;
  }
  return d;
}

function stripRootMotion(clip, model) {
  if (!clip?.tracks?.length) return clip;
  if (!model) return clip;

  // 找到所有 position 轨道对应的节点，挑出最"靠近根"的那一个（通常是 Hips / Armature）
  const posNodes = [];
  clip.tracks.forEach(t => {
    if (!t?.name?.endsWith('.position')) return;
    const nodeName = _extractTrackNodeName(t.name);
    if (!nodeName) return;
    const obj = model.getObjectByName(nodeName);
    if (obj) posNodes.push({ nodeName, obj });
  });

  if (posNodes.length === 0) return clip;

  // 优先命中常见名称，其次取 depth 最小的节点
  const preferred = posNodes.find(n => /hips|mixamorig/i.test(n.nodeName)) || null;
  const rootLike = preferred || posNodes.reduce((best, cur) => {
    const bd = _nodeDepth(best.obj, model);
    const cd = _nodeDepth(cur.obj, model);
    return cd < bd ? cur : best;
  }, posNodes[0]);

  const rootNames = new Set([rootLike.nodeName, 'Armature', 'armature', 'Root', 'root']);
  clip.tracks = clip.tracks.filter(track => {
    if (!track?.name?.endsWith('.position')) return true;
    const nodeName = _extractTrackNodeName(track.name);
    return !rootNames.has(nodeName);
  });
  return clip;
}

// 预加载单个动画GLB（通用）
function preloadAnim(key, url) {
  const fullUrl = url.startsWith('http') ? url : SERVER_BASE + url;
  const model = charGroup?.userData?.glbModel;
  if (!model) return;
  gltfLoader.load(fullUrl, (gltf) => {
    if (!gltf.animations?.length) { console.warn('[preloadAnim]', key, '无动画'); return; }

    // 若一个文件带多个 Clip，选择"对当前模型匹配度最高"的那个
    const clips = gltf.animations;

    // 检测是否为 Mixamo/Blender 导出的通用命名（mixamo.com, Armature|xxx 等）
    // 这类文件每个动作单独上传，直接取第一个 clip 即可
    const allGeneric = clips.every(c => {
      const n = (c.name || '').toLowerCase();
      return /^mixamo\.com|^armature\|/i.test(c.name || '') || n === '' || n === 'animation';
    });

    const scoreClip = (clip) => {
      let score = 0;
      clip.tracks.forEach(t => {
        const nodeName = _extractTrackNodeName(t.name);
        if (!nodeName) return;
        if (model.getObjectByName(nodeName)) score++;
      });
      // 轻微偏好名称里包含 key 的 clip
      const n = (clip.name || '').toLowerCase();
      if (n && n.includes(String(key).toLowerCase())) score += 5;
      if (key === 'idle' && /idle/.test(n)) score += 5;
      if (key === 'walk' && /walk/.test(n)) score += 5;
      if (key === 'run' && /run/.test(n)) score += 5;
      if (key === 'jump' && /jump/.test(n)) score += 5;
      if (key.startsWith('attack') && /attack|stab|slash|swing|upper/i.test(n)) score += 3;
      return score;
    };

    let best = clips[0];
    let bestScore = scoreClip(best);

    // 通用命名时跳过评分，直接用第一个 clip
    if (!allGeneric) {
      for (let i = 1; i < clips.length; i++) {
        const s = scoreClip(clips[i]);
        if (s > bestScore) { best = clips[i]; bestScore = s; }
      }
    }

    const clip = stripRootMotion(best, model);
    if (animMixers[key]) { animMixers[key].stopAllAction(); }
    const mixer = new THREE.AnimationMixer(model);
    const isLoop = (key === 'idle' || key === 'walk' || key === 'run');
    const action = mixer.clipAction(clip);
    action.loop = isLoop ? THREE.LoopRepeat : THREE.LoopOnce;
    if (!isLoop) action.clampWhenFinished = true;
    animMixers[key] = mixer;
    animActions[key] = action;
    console.log(`[preloadAnim] ${key} 已加载: ${clip.name} (score=${bestScore})`);
    // 若匹配度很低，提示用户动画可能不是同一骨骼
    if (bestScore < 5) {
      showNotif(`⚠️ ${_animLabel(key)} 可能与当前模型骨骼不匹配（预览可能不动/不对）`);
    }
    updateAnimStatusGrid();
    // 如果用户已经点了这个动作（正在等待加载），加载完后自动播放
    if (currentAnimMode === key) { switchAnim(key); }
    // 如果是idle动画加载完成，主动播放待机（确保角色不在T-pose状态）
    if (key === 'idle') {
      console.log('[preloadAnim] idle动画加载完成，检查当前状态');
      // 如果当前没有动画在播放，或者当前模式就是idle，则播放
      const curAction = animActions[currentAnimMode];
      const hasRunning = curAction && curAction.isRunning();
      if (!hasRunning || currentAnimMode === 'idle') {
        console.log('[preloadAnim] 自动播放idle动画');
        switchAnim('idle');
      }
    }
  }, null, (err) => { console.warn('[preloadAnim]', key, '加载失败', err); });
}

// 兼容旧调用
function preloadWalkRun(type, url) { preloadAnim(type, url); }

// 切换动画（统一入口）
function switchAnim(mode, transitionTime = 0.3) {
  // 停掉当前
  const prev = currentAnimMode;
  if (prev !== mode) {
    const prevAction = animActions[prev];
    if (prevAction && prevAction.isRunning()) {
      prevAction.fadeOut(transitionTime);
    }
    if (glbCurrentAction && glbCurrentAction.isRunning()) {
      glbCurrentAction.fadeOut(transitionTime);
    }
  }
  currentAnimMode = mode;
  const action = animActions[mode];
  if (action) {
    action.reset().fadeIn(transitionTime).play();
  }
  document.getElementById('hud-anim').textContent = mode;
}

// 动画状态格子渲染
const ANIM_LABELS_BASE = {
  idle: '🧍待机', walk: '🚶走路', run: '🏃奔跑', jump: '🦘跳跃',
  attack1: '⚔️普攻1', attack2: '⚔️连击2', attack3: '⚔️连击3',
  hit: '💢受击', death: '💀死亡',
  turn_left: '↰左转', turn_right: '↱右转',
  attack_stab: '🗡️刺', attack_slash: '⚔️砍', attack_swing: '🌀挥', attack_uppercut: '⬆️挑',
  draw_sword: '🧍拿剑站立', sheath: '🔙收剑',
};
// 扩展技能标签（动态，key=skill_<id>）
const ANIM_LABELS_EXT = {};
function _animLabel(k) { return ANIM_LABELS_BASE[k] || ANIM_LABELS_EXT[k] || k; }

function updateAnimStatusGrid() {
  const grid = document.getElementById('anim-status-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const totalKeys = ANIM_KEYS.length;
  const titleEl = document.getElementById('anim-status-title');
  if (titleEl) titleEl.textContent = `📊 MVP 动作状态（${totalKeys}个）`;
  ANIM_KEYS.forEach(k => {
    const hasUrl = !!tmplAnimUrls[k];
    const loaded = !!animActions[k];
    const status = !hasUrl ? '❌ 未配置' : (loaded ? '✅ 已加载' : '⏳ 加载中');
    const color = !hasUrl ? '#444' : (loaded ? '#00ff00' : '#ff8800');
    const div = document.createElement('div');
    div.style.cssText = 'background:rgba(0,0,0,0.35);border:1px solid rgba(0,255,0,0.2);border-radius:5px;padding:6px 5px;';
    div.innerHTML = `<div style="font-size:9px;color:#555;margin-bottom:2px;">${_animLabel(k)}</div>
      <div style="font-size:10px;color:${color};">${status}</div>
      ${hasUrl ? `<button style="margin-top:3px;font-size:9px;padding:2px 5px;background:rgba(255,255,255,0.08);border:1px solid rgba(0,255,0,0.2);border-radius:3px;color:#aaa;cursor:pointer;" onclick="preloadAnim('${k}','${tmplAnimUrls[k]}')">🔄</button>` : ''}`;
    grid.appendChild(div);
  });
}

// 动态更新测试按钮区
function updateTestAnimButtons() {
  const grid = document.getElementById('anim-test-grid');
  if (!grid) return;
  // 移除所有扩展技能按钮（id以 ab-skill_ 开头）
  grid.querySelectorAll('[data-skill-btn]').forEach(el => el.remove());
  // 把停止按钮暂时取出
  const stopBtn = document.getElementById('ab-stop');
  if (stopBtn) stopBtn.remove();
  // 追加扩展技能按钮
  ANIM_KEYS.filter(k => k.startsWith('skill_')).forEach(k => {
    if (document.getElementById('ab-' + k)) return; // 已存在
    const label = _animLabel(k);
    const div = document.createElement('div');
    div.className = 'ab';
    div.id = 'ab-' + k;
    div.setAttribute('data-skill-btn', '1');
    div.textContent = label;
    div.onclick = () => testAnim(k);
    grid.appendChild(div);
  });
  // 重新放回停止按钮
  if (stopBtn) grid.appendChild(stopBtn);
  else {
    const s = document.createElement('div'); s.className = 'ab'; s.id = 'ab-stop'; s.textContent = '⏹ 停止'; s.onclick = stopAnim; grid.appendChild(s);
  }
}

// 动画循环
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
  const dts = dt * cfg.attack.slowRate;
  
  // 只更新需要的mixer
  if (glbMixer) glbMixer.update(dts);
  
  // 只更新当前活动的动画mixer
  const currentAction = animActions[currentAnimMode];
  if (currentAction && currentAction.isRunning()) {
    const mixer = animMixers[currentAnimMode];
    if (mixer) mixer.update(dts);
  }
  
  if (charGroup && charGroup.userData.leftArm) runBlockAnim(dts);
  
  // 武器光晕脉动 - 每2帧更新一次，减少计算
  if (weaponGroup && Math.floor(now / 16) % 2 === 0) {
    const p = 0.8 + Math.sin(now / 500) * 0.2;
    if (weaponGroup.userData.blade) weaponGroup.userData.blade.material.emissiveIntensity = cfg.sword.glowIntensity * p;
    if (weaponGroup.userData.orb) weaponGroup.userData.orb.material.emissiveIntensity = 0.8 * p;
  }
  
  // 更新动画时间轴
  updateAnimationTime(dt);
  
  // 更新技能特效预览

  
  controls.update(); renderer.render(scene, camera);
  
  // FPS计算
  fCount++; fSample += dt; if (fSample >= 1) { document.getElementById('hud-fps').textContent = fCount; fCount = 0; fSample = 0; }
}

function runBlockAnim(dt) {
  const ud = charGroup.userData;
  if (currentAnimMode === 'walk' || currentAnimMode === 'run') {
    animTime += dt * (currentAnimMode === 'run' ? 7 : 4);
    const s = Math.sin(animTime) * cfg.attack.walkSwing * (currentAnimMode === 'run' ? 1.4 : 1);
    if (ud.leftArm) ud.leftArm.rotation.x = s;
    if (ud.rightArm) ud.rightArm.rotation.x = -s;
    if (ud.leftLeg) ud.leftLeg.rotation.x = -s;
    if (ud.rightLeg) ud.rightLeg.rotation.x = s;
    if (currentAnimMode === 'run') charGroup.position.y = 1.5 + Math.abs(Math.sin(animTime)) * 0.05;
  }
}

function resetLimbs() {
  if (!charGroup) return;
  const ud = charGroup.userData;
  ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].forEach(k => { if (ud[k]) { ud[k].rotation.x = 0; ud[k].rotation.z = 0; } });
  charGroup.position.y = 1.5; charGroup.rotation.x = 0; charGroup.rotation.y = 0;
}

// 动作测试
function testAnim(mode) {
  document.querySelectorAll('.ab').forEach(b => b.classList.remove('playing'));
  document.getElementById('ab-' + mode)?.classList.add('playing');
  if (charGroup?.userData?.glbModel) {
    // GLB角色：使用独立动画GLB
    if (ANIM_KEYS.includes(mode)) {
      // 未加载但已配置 URL：点击即触发一次加载
      if (!animActions[mode] && tmplAnimUrls[mode]) {
        preloadAnim(mode, tmplAnimUrls[mode]);
      }
      switchAnim(mode);
      if (!animActions[mode]) {
        const hint = tmplAnimUrls[mode] ? '正在加载中' : '请在管理后台上传此动画GLB';
        showNotif(`⚠️ ${_animLabel(mode)}动画未就绪，${hint}`);
      }
    } else if (mode === 'slash1' || mode === 'slash2') {
      // 兼容旧调用（slash1/slash2 映射到 attack1/attack2）
      const mapped = mode === 'slash1' ? 'attack1' : 'attack2';
      if (!animActions[mapped] && tmplAnimUrls[mapped]) {
        preloadAnim(mapped, tmplAnimUrls[mapped]);
      }
      switchAnim(mapped);
      if (!animActions[mapped]) {
        showNotif(`⚠️ ${mapped} 动画未就绪，请在管理后台上传此动画GLB`);
      }
    }
    document.getElementById('hud-anim').textContent = mode;
    return;
  }
  // 方块人动画
  if (mode === 'walk' || mode === 'run') { currentAnimMode = mode; }
  else if (mode === 'idle') { currentAnimMode = 'idle'; resetLimbs(); }
  else { currentAnimMode = 'idle'; doSlash(mode === 'slash1' ? 1 : mode === 'slash2' ? 2 : 3); }
  document.getElementById('hud-anim').textContent = mode;
}

function stopAnim() {
  currentAnimMode = 'idle';
  if (charGroup?.userData?.glbModel) { switchAnim('idle'); }
  else { resetLimbs(); applyPreset(cfg.preset, false); }
  document.querySelectorAll('.ab').forEach(b => b.classList.remove('playing'));
  document.getElementById('hud-anim').textContent = '待机';
  resetAnimation();
}

function doSlash(idx) {
  if (!charGroup?.userData?.rightArm) return;
  const ud = charGroup.userData, dur = cfg.attack.duration, t0 = Date.now();
  const orig = { rx: ud.rightArm.rotation.x, rz: ud.rightArm.rotation.z, by: charGroup.rotation.y };
  function step() {
    const prog = Math.min((Date.now() - t0) / dur, 1), e = prog < 0.5 ? 4 * prog * prog * prog : 1 - Math.pow(-2 * prog + 2, 3) / 2;
    if (idx === 1) { ud.rightArm.rotation.x = orig.rx + (-1.0 + 2.0 * e); ud.rightArm.rotation.z = -0.3 * Math.sin(e * Math.PI); }
    else if (idx === 2) { ud.rightArm.rotation.x = orig.rx + (-0.5 + 1.5 * e); }
    else { charGroup.rotation.y = orig.by + Math.PI * 2 * e; ud.rightArm.rotation.z = -0.4; }
    if (prog < 1) requestAnimationFrame(step); else setTimeout(() => stopAnim(), 100);
  } step();
}

// 动画预览与编辑功能
function toggleAnimation() {
  isAnimPlaying = !isAnimPlaying;
  const btn = document.querySelector('button[onclick="toggleAnimation()"]');
  btn.textContent = isAnimPlaying ? '⏸ 暂停' : '▶ 播放';
}

function resetAnimation() {
  isAnimPlaying = false;
  animCurrentTime = 0;
  updateTimeline();
  const btn = document.querySelector('button[onclick="toggleAnimation()"]');
  btn.textContent = '▶ 播放';
}

function onAnimSpeed(value) {
  animSpeed = parseFloat(value);
  document.getElementById('anim-speed-v').textContent = animSpeed.toFixed(1) + '×';
  // 应用到当前动画
  if (glbMixer) {
    glbMixer.timeScale = animSpeed;
  }
  const currentAction = animActions[currentAnimMode];
  if (currentAction) {
    currentAction.setEffectiveTimeScale(animSpeed);
  }
}

function onAnimLoop(value) {
  animLoopMode = value;
  // 应用到当前动画
  const currentAction = animActions[currentAnimMode];
  if (currentAction) {
    if (animLoopMode === 'none') {
      currentAction.setLoop(THREE.LoopOnce);
      currentAction.clampWhenFinished = true;
    } else if (animLoopMode === 'loop') {
      currentAction.setLoop(THREE.LoopRepeat);
    } else if (animLoopMode === 'pingpong') {
      currentAction.setLoop(THREE.LoopPingPong);
    }
  }
}

function onAnimDuration(value) {
  animDuration = parseFloat(value);
}

function updateTimeline() {
  const timeline = document.getElementById('anim-timeline');
  const timeDisplay = document.getElementById('anim-time');
  
  if (animTotalTime > 0) {
    const progress = (animCurrentTime / animTotalTime) * 100;
    timeline.style.width = Math.min(progress, 100) + '%';
  } else {
    timeline.style.width = '0%';
  }
  
  timeDisplay.textContent = `${animCurrentTime.toFixed(1)}s / ${animTotalTime.toFixed(1)}s`;
}

// 在动画循环中更新时间轴
function updateAnimationTime(dt) {
  if (!isAnimPlaying) return;
  
  animCurrentTime += dt * animSpeed;
  
  // 处理循环
  if (animCurrentTime >= animDuration) {
    if (animLoopMode === 'none') {
      isAnimPlaying = false;
      animCurrentTime = animDuration;
    } else if (animLoopMode === 'loop') {
      animCurrentTime = 0;
    } else if (animLoopMode === 'pingpong') {
      animCurrentTime = animDuration - (animCurrentTime - animDuration);
      animSpeed = -animSpeed;
    }
  }
  
  updateTimeline();
}

// GLB 动画列表
function buildGLBAnimList() {
  const c = document.getElementById('glb-anim-list');
  if (!glbAnimations.length) { c.textContent = '此模型无内置动画'; return; }
  c.innerHTML = '';
  glbAnimations.forEach((clip, i) => {
    const btn = document.createElement('div'); btn.className = 'ab'; btn.style.marginBottom = '4px';
    btn.textContent = `▶ ${clip.name || 'Clip_' + i} (${clip.duration.toFixed(1)}s)`;
    btn.onclick = () => playGLBClip(i); c.appendChild(btn);
  });
  document.getElementById('glb-anim-section').style.display = 'block';
}

function playGLBClip(i) {
  if (!glbMixer || !glbAnimations[i]) return;
  if (glbCurrentAction) glbCurrentAction.fadeOut(0.2);
  glbCurrentAction = glbMixer.clipAction(glbAnimations[i]);
  glbCurrentAction.reset().fadeIn(0.2).play();
  showNotif(`▶ ${glbAnimations[i].name || 'Clip_' + i}`);
}
