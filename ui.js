function makeEl(tag, cssText, innerHTML = '') {
  const e = document.createElement(tag);
  e.style.cssText = cssText;
  e.innerHTML = innerHTML;
  return e;
}

export function createUI(params, { onSuspChange } = {}) {
  // --- Debug panel ---
  const panel = makeEl('div',
    'position:fixed;top:12px;left:12px;background:rgba(0,0,0,.6);color:#fff;' +
    'padding:10px 14px;border-radius:8px;font:12px monospace;' +
    'display:flex;flex-direction:column;gap:6px;z-index:10;min-width:300px'
  );
  document.body.appendChild(panel);

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

  // --- Score display ---
  const scoreEl = makeEl('div',
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
    'background:rgba(0,0,0,.6);color:#fff;padding:8px 24px;border-radius:8px;' +
    'font:bold 22px monospace;z-index:10;text-align:center;line-height:1.5',
    '<div style="font-size:11px;opacity:.7;letter-spacing:1px">DISTANCE</div>' +
    '<div id="scoreVal">0 m</div>'
  );
  document.body.appendChild(scoreEl);
  const scoreVal = scoreEl.querySelector('#scoreVal');

  // --- Obstacle counter ---
  const counterEl = makeEl('div',
    'position:fixed;top:12px;right:12px;background:rgba(0,0,0,.6);color:#fff;' +
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
      scoreVal.textContent = `${Math.floor(score)} m`;
      counterEl.innerHTML  = `Spawned: ${spawned}<br>Alive: ${alive}`;
      rpmBar.style.width      = `${rpm * 100}%`;
      rpmBar.style.background = rpm < 0.6 ? '#44ff44' : rpm < 0.85 ? '#ffdd00' : '#ff3333';
    },
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
