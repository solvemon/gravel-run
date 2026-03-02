function makeEl(tag, cssText, innerHTML = '') {
  const e = document.createElement(tag);
  e.style.cssText = cssText;
  e.innerHTML = innerHTML;
  return e;
}

export function createUI(params, { onSuspChange, onAudioChange, onReset, onMuteToggle, onDebugToggle } = {}) {
  // --- Settings toggle button ---
  const toggleBtn = makeEl('div',
    'position:fixed;top:12px;left:12px;z-index:11;width:38px;height:38px;' +
    'background:rgba(0,0,0,.6);color:#fff;border-radius:8px;font:20px monospace;' +
    'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
    'user-select:none;-webkit-user-select:none;',
    '⚙'
  );
  document.body.appendChild(toggleBtn);

  // --- Settings panel (hidden by default) ---
  const panel = makeEl('div',
    'position:fixed;top:58px;left:12px;background:rgba(0,0,0,.6);color:#fff;' +
    'padding:10px 14px;border-radius:8px;font:12px monospace;' +
    'display:none;flex-direction:column;gap:6px;z-index:10;min-width:300px;' +
    'max-height:calc(100vh - 80px);overflow-y:auto;'
  );
  document.body.appendChild(panel);

  toggleBtn.addEventListener('click', () => {
    const isOpen = panel.style.display !== 'none';
    panel.style.display  = isOpen ? 'none' : 'flex';
    toggleBtn.innerHTML  = isOpen ? '⚙' : '✕';
  });

  // Reads initial value from params[key]; writes back on change
  function addSlider(label, min, max, step, key, fmt, onChange) {
    const row    = makeEl('div', 'display:flex;align-items:center;gap:8px');
    const lbl    = makeEl('span', 'width:150px;flex-shrink:0');
    const slider = makeEl('input', 'flex:1');
    const val    = makeEl('span', 'width:70px;text-align:right');
    lbl.textContent = label;
    Object.assign(slider, { type: 'range', min, max, step, value: params[key] });
    val.textContent = fmt(params[key]);
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      val.textContent = fmt(v);
      params[key] = v;
      onChange?.();
    });
    row.append(lbl, slider, val);
    panel.appendChild(row);
  }

  addSlider('Ride height',             -100, 100, 1,    'carBodyYOffset',   v => `${v} px`);
  addSlider('Wheel radius',               8,  60, 1,    'wheelRadius',      v => `${v} px (⌀${(v * 2 / 48 * 100 | 0)} cm)`);
  addSlider('Spring freq',              0.5,  12, 0.1,  'suspFreq',         v => `${v} Hz`,    onSuspChange);
  addSlider('Damping ratio',           0.05, 1.5, 0.05, 'suspDamping',      v => `${v}`,       onSuspChange);
  addSlider('Motor torque',               5, 500, 5,    'maxTorque',        v => `${v} N·m`);
  addSlider('Max speed',                  1,  40, 1,    'driveSpeed',       v => `${v} rad/s`);
  addSlider('Friction wheel/ground',      0,   2, 0.05, 'frWheelGround',    v => `${v}`);
  addSlider('Friction wheel/obstacle',    0,   2, 0.05, 'frWheelObstacle',  v => `${v}`);
  addSlider('Friction obstacle/ground',   0,   2, 0.05, 'frObstacleGround', v => `${v}`);

  addSlider('── Gain: intake',            0,   2, 0.05, 'gainIntake',        v => `${v}`,  onAudioChange);
  addSlider('── Gain: engine block',      0,   2, 0.05, 'gainBlock',         v => `${v}`,  onAudioChange);
  addSlider('── Gain: exhaust',           0,   2, 0.05, 'gainOutlet',        v => `${v}`,  onAudioChange);
  addSlider('── Gain: master',            0,   1, 0.005, 'masterGain',        v => `${v}`,  onAudioChange);

  // --- Debug toggle ---
  const dbgRow = makeEl('div', 'display:flex;align-items:center;gap:8px;margin-top:4px');
  const dbgLbl = makeEl('span', 'width:150px;flex-shrink:0');
  dbgLbl.textContent = 'Show hitboxes';
  const dbgChk = makeEl('input', '');
  dbgChk.type = 'checkbox';
  dbgChk.addEventListener('change', () => onDebugToggle?.());
  dbgRow.append(dbgLbl, dbgChk);
  panel.appendChild(dbgRow);
  // --- Score display ---
  let best       = parseInt(localStorage.getItem('gravel-run-best') || '0');
  let savedBest  = best; // threshold for the current run — updated on reset

  const scoreEl = makeEl('div',
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
    'background:rgba(0,0,0,.6);color:#fff;padding:8px 24px;border-radius:8px;' +
    'font:bold 22px monospace;z-index:10;text-align:center;line-height:1.5',
    '<div style="font-size:11px;opacity:.7;letter-spacing:1px">DISTANCE</div>' +
    '<div id="scoreVal">0 m</div>' +
    '<div id="bestRow" style="font-size:11px;opacity:.6;font-weight:normal;margin-top:1px">' +
      `BEST: ${best} m` +
    '</div>'
  );
  document.body.appendChild(scoreEl);
  const scoreVal = scoreEl.querySelector('#scoreVal');
  const bestRow  = scoreEl.querySelector('#bestRow');

  // --- Mute button ---
  let muted = false;
  const muteBtn = makeEl('div',
    'position:fixed;top:12px;right:60px;z-index:11;width:38px;height:38px;' +
    'background:rgba(0,0,0,.6);color:#fff;border-radius:8px;font:20px monospace;' +
    'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
    'user-select:none;-webkit-user-select:none;',
    '🔊'
  );
  const toggleMute = () => {
    muted = !muted;
    muteBtn.innerHTML = muted ? '🔇' : '🔊';
    onMuteToggle?.(muted);
  };
  muteBtn.addEventListener('click', toggleMute);
  muteBtn.addEventListener('touchstart', e => { e.preventDefault(); toggleMute(); }, { passive: false });
  document.body.appendChild(muteBtn);

  // --- Reset button ---
  const resetBtn = makeEl('div',
    'position:fixed;top:12px;right:12px;z-index:11;width:38px;height:38px;' +
    'background:rgba(0,0,0,.6);color:#fff;border-radius:8px;font:20px monospace;' +
    'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
    'user-select:none;-webkit-user-select:none;',
    '↺'
  );
  resetBtn.addEventListener('click', () => onReset?.());
  resetBtn.addEventListener('touchstart', e => { e.preventDefault(); onReset?.(); }, { passive: false });
  document.body.appendChild(resetBtn);

  // --- Obstacle counter ---
  const counterEl = makeEl('div',
    'position:fixed;top:60px;right:12px;background:rgba(0,0,0,.6);color:#fff;' +
    'padding:8px 12px;border-radius:8px;font:12px monospace;z-index:10;line-height:1.6'
  );
  document.body.appendChild(counterEl);

  // --- Rev gauge (raised so touch buttons don't overlap it) ---
  const gaugeWrap = makeEl('div',
    'position:fixed;bottom:130px;right:24px;z-index:10;' +
    'background:rgba(0,0,0,.6);padding:8px 12px;border-radius:8px;' +
    'font:11px monospace;color:#fff;text-align:center;min-width:160px',
    '<div style="letter-spacing:1px;margin-bottom:5px">REV</div>' +
    '<div style="background:#111;border-radius:3px;height:14px;overflow:hidden">' +
    '<div id="rpmBar" style="height:100%;width:0%;background:#44ff44;transition:background .1s"></div>' +
    '</div>'
  );
  document.body.appendChild(gaugeWrap);
  const rpmBar = gaugeWrap.querySelector('#rpmBar');

  return {
    // Called every frame
    update({ score, spawned, alive, rpm }) {
      const dist = Math.floor(score);
      scoreVal.textContent = `${dist} m`;
      counterEl.innerHTML  = `Spawned: ${spawned}<br>Alive: ${alive}`;
      rpmBar.style.width      = `${rpm * 100}%`;
      rpmBar.style.background = rpm < 0.6 ? '#44ff44' : rpm < 0.85 ? '#ffdd00' : '#ff3333';

      if (dist > best) {
        best = dist;
        localStorage.setItem('gravel-run-best', best);
      }
      const isRecord = dist > savedBest;
      bestRow.textContent = `${isRecord ? '★ ' : ''}BEST: ${best} m`;
    },

    // Call on reset so the star threshold advances to the new best
    resetBest() { savedBest = best; },
  };
}

// Touch/click buttons that drive the same `keys` object the keyboard handler uses.
// onGesture is called on first press so the AudioContext can be resumed.
export function createTouchControls(keys, { onGesture } = {}) {
  const btnBase =
    'position:fixed;bottom:24px;z-index:10;width:120px;height:90px;' +
    'background:rgba(0,0,0,.55);color:#fff;border:2px solid rgba(255,255,255,.25);' +
    'border-radius:14px;font:bold 32px monospace;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:4px;cursor:pointer;' +
    'user-select:none;-webkit-user-select:none;touch-action:none;';

  function makeButton(icon, label, side, key) {
    const btn = makeEl('div', btnBase + `${side}:24px;`);
    btn.innerHTML =
      `<span>${icon}</span>` +
      `<span style="font-size:10px;opacity:.7;letter-spacing:1px">${label}</span>`;

    const press   = () => { keys[key] = true;  onGesture?.(); btn.style.background = 'rgba(255,255,255,.2)'; };
    const release = () => { keys[key] = false; btn.style.background = 'rgba(0,0,0,.55)'; };

    btn.addEventListener('touchstart',  e => { e.preventDefault(); press(); },   { passive: false });
    btn.addEventListener('touchend',    e => { e.preventDefault(); release(); }, { passive: false });
    btn.addEventListener('touchcancel', e => { e.preventDefault(); release(); }, { passive: false });
    btn.addEventListener('mousedown',  press);
    btn.addEventListener('mouseup',    release);
    btn.addEventListener('mouseleave', release);

    document.body.appendChild(btn);
  }

  makeButton('◀', 'BRAKE', 'left',  's');
  makeButton('▶', 'GO',    'right', 'w');
}
