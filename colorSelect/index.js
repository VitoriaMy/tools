import * as THREE from 'three';

// ---------- DOM ----------
const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
const channelsEl = document.getElementById('channels');
const mainSwatch = document.getElementById('mainSwatch');
const mainRGB = document.getElementById('mainRGB');
const mainHex = document.getElementById('mainHex');
const mainLabel = document.getElementById('mainLabel');
const hoverPosEl = document.getElementById('hoverPos');
const hoverColorEl = document.getElementById('hoverColor');
const hoverSwatchEl = document.getElementById('hoverSwatch');

// ---------- helpers ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const coordToChannel = (c, min, max) => min + Math.round(clamp(c, 0, 1) * (max - min));
const MAX_SIZE = 256;
const rangeToSize = ({ min, max }) => max - min + 1;
const axisHeadOffset = (size) => Math.max(0.12, size * 0.04);
const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
const cssColor = (r, g, b) => `rgb(${r}, ${g}, ${b})`;
const channelRanges = {
    r: { min: 0, max: 255 },
    g: { min: 0, max: 255 },
    b: { min: 0, max: 255 },
};

// ---------- renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
const target = new THREE.Vector3(0, 0, 0);
const spherical = new THREE.Spherical(800, 1.0, 0.8); // radius, phi, theta

function updateCamera() {
    camera.position.setFromSpherical(spherical).add(target);
    camera.lookAt(target);
}
updateCamera();

// ---------- materials ----------
// 立方体从原点沿正轴延展，局部坐标映射到 RGB。
const cubeMaterial = new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
    uniforms: {
        uMinColor: { value: new THREE.Vector3(0, 0, 0) },
        uColorSpan: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: `
        varying vec3 vLocalPos;
        void main() {
            vLocalPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: `
        uniform vec3 uMinColor;
        uniform vec3 uColorSpan;
        varying vec3 vLocalPos;
        void main() {
            vec3 c = uMinColor + clamp(vLocalPos, 0.0, 1.0) * uColorSpan;
            gl_FragColor = vec4(c, 1.0);
        }`
});

const cubeEdgeMaterial = new THREE.ShaderMaterial({
    transparent: false,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: cubeMaterial.uniforms,
    vertexShader: `
        varying vec3 vLocalPos;
        void main() {
            vLocalPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: `
        uniform vec3 uMinColor;
        uniform vec3 uColorSpan;
        varying vec3 vLocalPos;
        void main() {
            vec3 surfaceColor = uMinColor + clamp(vLocalPos, 0.0, 1.0) * uColorSpan;
            gl_FragColor = vec4(vec3(1.0) - surfaceColor, 1.0);
        }`
});

// ---------- 主模型：RGB 值直接控制 X/Y/Z 尺寸 ----------
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
cubeGeometry.translate(0.5, 0.5, 0.5);
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
cube.scale.setScalar(MAX_SIZE);
scene.add(cube);

const cubeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    cubeEdgeMaterial
);
cube.add(cubeEdges);

// ---------- RGB 范围坐标轴 ----------
const channelDefs = {
    r: { axis: 'x', direction: new THREE.Vector3(1, 0, 0), tag: 'R', css: 'tag-r', color: 0xff4d4d },
    g: { axis: 'y', direction: new THREE.Vector3(0, 1, 0), tag: 'G', css: 'tag-g', color: 0x4dff6e },
    b: { axis: 'z', direction: new THREE.Vector3(0, 0, 1), tag: 'B', css: 'tag-b', color: 0x4d7dff },
};

const axes = {};
for (const [key, def] of Object.entries(channelDefs)) {
    const axis = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: def.color, depthTest: true, depthWrite: false })
    );
    axis.renderOrder = 7;
    scene.add(axis);
    axes[key] = { mesh: axis, def };
}

function updateAxisGeometry(key) {
    const { mesh, def } = axes[key];
    const range = channelRanges[key];
    const size = rangeToSize(range);
    const axisLength = size + axisHeadOffset(size);
    const direction = def.direction;
    const tickDirection = def.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const points = [new THREE.Vector3(), direction.clone().multiplyScalar(axisLength)];

    for (let tick = range.min; tick <= range.max; tick += 32) {
        const tickPoint = direction.clone().multiplyScalar(tick - range.min + 0.5);
        const halfLength = tick === range.max ? Math.max(0.08, size * 0.008) : Math.max(0.06, size * 0.006);
        points.push(tickPoint.clone().addScaledVector(tickDirection, -halfLength));
        points.push(tickPoint.clone().addScaledVector(tickDirection, halfLength));
    }
    if ((range.max - range.min) % 32 !== 0) {
        const endPoint = direction.clone().multiplyScalar(size - 0.5);
        const halfLength = Math.max(0.08, size * 0.008);
        points.push(endPoint.clone().addScaledVector(tickDirection, -halfLength));
        points.push(endPoint.clone().addScaledVector(tickDirection, halfLength));
    }

    const oldGeometry = mesh.geometry;
    mesh.geometry = new THREE.BufferGeometry().setFromPoints(points);
    oldGeometry.dispose();
}

function updateModel(updateView = true, fitCamera = updateView) {
    for (const key of ['r', 'g', 'b']) {
        cube.scale[channelDefs[key].axis] = rangeToSize(channelRanges[key]);
    }
    cubeMaterial.uniforms.uMinColor.value.set(
        channelRanges.r.min / 255,
        channelRanges.g.min / 255,
        channelRanges.b.min / 255
    );
    cubeMaterial.uniforms.uColorSpan.value.set(
        (channelRanges.r.max - channelRanges.r.min) / 255,
        (channelRanges.g.max - channelRanges.g.min) / 255,
        (channelRanges.b.max - channelRanges.b.min) / 255
    );
    for (const key of ['r', 'g', 'b']) {
        const def = channelDefs[key];
        const direction = def.direction;
        const size = cube.scale[def.axis];
        updateAxisGeometry(key);
    }
    if (updateView) {
        target.set(cube.scale.x / 2, cube.scale.y / 2, cube.scale.z / 2);
        if (fitCamera) {
            spherical.radius = Math.max(4, Math.max(cube.scale.x, cube.scale.y, cube.scale.z) * 4.2);
        }
        updateCamera();
    }
}
updateModel();

function pickedColor() {
    return {
        r: Math.round((channelRanges.r.min + channelRanges.r.max) / 2),
        g: Math.round((channelRanges.g.min + channelRanges.g.max) / 2),
        b: Math.round((channelRanges.b.min + channelRanges.b.max) / 2),
    };
}

// ---------- 模型表面悬停选区：反色 3D 线框 ----------
const hoverBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: false })
);
hoverBox.renderOrder = 10;
hoverBox.visible = false;
cube.add(hoverBox);

// ---------- 拾取 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null; // { r, g, b, x, y, z }

const hoverTargets = [cube];

function setPointer(e) {
    setPointerPosition(e.clientX, e.clientY);
}

function setPointerPosition(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function getModelHit() {
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(hoverTargets, false)[0] || null;
}

function updateHover(hit) {
    if (hit) {
        const p = cube.worldToLocal(hit.point.clone());
        const r = coordToChannel(p.x, channelRanges.r.min, channelRanges.r.max);
        const g = coordToChannel(p.y, channelRanges.g.min, channelRanges.g.max);
        const b = coordToChannel(p.z, channelRanges.b.min, channelRanges.b.max);
        hovered = { r, g, b, x: r, y: g, z: b };
        const faceNormal = hit.face.normal;
        const faceCenter = new THREE.Vector3(
            (r - channelRanges.r.min + 0.5) / cube.scale.x,
            (g - channelRanges.g.min + 0.5) / cube.scale.y,
            (b - channelRanges.b.min + 0.5) / cube.scale.z
        );
        const offset = 0.01;
        if (Math.abs(faceNormal.x) > 0.5) {
            faceCenter.x = faceNormal.x > 0 ? 1 + offset / cube.scale.x : -offset / cube.scale.x;
            hoverBox.scale.set(1 / cube.scale.z, 1 / cube.scale.y, 1);
        } else if (Math.abs(faceNormal.y) > 0.5) {
            faceCenter.y = faceNormal.y > 0 ? 1 + offset / cube.scale.y : -offset / cube.scale.y;
            hoverBox.scale.set(1 / cube.scale.x, 1 / cube.scale.z, 1);
        } else {
            faceCenter.z = faceNormal.z > 0 ? 1 + offset / cube.scale.z : -offset / cube.scale.z;
            hoverBox.scale.set(1 / cube.scale.x, 1 / cube.scale.y, 1);
        }
        hoverBox.position.copy(faceCenter);
        hoverBox.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceNormal);
        hoverBox.visible = true;
        // 反色线框
        hoverBox.material.color.setRGB((255 - r) / 255, (255 - g) / 255, (255 - b) / 255);
    } else {
        hovered = null;
        hoverBox.visible = false;
    }
}

// ---------- 右侧面板 ----------
const channelUI = {};
for (const key of ['r', 'g', 'b']) {
    const def = channelDefs[key];
    const wrap = document.createElement('div');
    wrap.className = 'channel';
    wrap.innerHTML = `
        <div class="channel-head">
            <span class="tag ${def.css}">${def.tag}</span>
            <span class="range"></span>
        </div>
        <div class="range-control" role="group" aria-label="${def.tag} 色值范围">
            <div class="range-track"></div>
            <div class="range-fill"></div>
            <div class="range-thumb min-thumb" data-endpoint="min" role="slider" tabindex="0" aria-label="${def.tag} 最小值" aria-valuemin="0" aria-valuemax="255"></div>
            <div class="range-thumb max-thumb" data-endpoint="max" role="slider" tabindex="0" aria-label="${def.tag} 最大值" aria-valuemin="0" aria-valuemax="255"></div>
        </div>`;
    channelsEl.appendChild(wrap);

    const el = channelUI[key] = {
        range: wrap.querySelector('.range'),
        control: wrap.querySelector('.range-control'),
        fill: wrap.querySelector('.range-fill'),
        minThumb: wrap.querySelector('.min-thumb'),
        maxThumb: wrap.querySelector('.max-thumb'),
    };

    let activeEndpoint = null;
    let equalRangePending = false;
    let dragStartX = 0;
    const setEndpoint = (endpoint, value) => {
        const range = channelRanges[key];
        if (endpoint === 'min') range.min = Math.min(value, range.max);
        else range.max = Math.max(value, range.min);
        updateModel(true, false);
        refresh();
    };
    const valueAt = (clientX) => {
        const rect = el.control.getBoundingClientRect();
        const trackWidth = Math.max(1, rect.width - 18);
        return Math.round(clamp((clientX - rect.left - 9) / trackWidth, 0, 1) * 255);
    };

    el.control.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const range = channelRanges[key];
        const thumb = event.target.closest('.range-thumb');
        equalRangePending = range.min === range.max;
        dragStartX = event.clientX;
        if (equalRangePending) activeEndpoint = null;
        else if (thumb) activeEndpoint = thumb.dataset.endpoint;
        else {
            const value = valueAt(event.clientX);
            activeEndpoint = Math.abs(value - range.min) <= Math.abs(value - range.max) ? 'min' : 'max';
        }
        el.control.setPointerCapture(event.pointerId);
        if (activeEndpoint) setEndpoint(activeEndpoint, valueAt(event.clientX));
    });
    el.control.addEventListener('pointermove', (event) => {
        if (!el.control.hasPointerCapture(event.pointerId)) return;
        if (equalRangePending) {
            const direction = event.clientX - dragStartX;
            if (direction === 0) return;
            activeEndpoint = direction > 0 ? 'max' : 'min';
            equalRangePending = false;
        }
        if (activeEndpoint) setEndpoint(activeEndpoint, valueAt(event.clientX));
    });
    const stopDrag = (event) => {
        if (el.control.hasPointerCapture(event.pointerId)) el.control.releasePointerCapture(event.pointerId);
        activeEndpoint = null;
        equalRangePending = false;
    };
    el.control.addEventListener('pointerup', stopDrag);
    el.control.addEventListener('pointercancel', stopDrag);

    el.control.addEventListener('keydown', (event) => {
        const thumb = event.target.closest('.range-thumb');
        if (!thumb) return;
        const endpoint = thumb.dataset.endpoint;
        const current = channelRanges[key][endpoint];
        let next = current;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 1;
        else if (event.key === 'PageUp') next += 10;
        else if (event.key === 'PageDown') next -= 10;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 255;
        else return;
        event.preventDefault();
        setEndpoint(endpoint, clamp(next, 0, 255));
    });
}

function renderRangeControl(key) {
    const range = channelRanges[key];
    const el = channelUI[key];
    const trackWidth = Math.max(0, el.control.clientWidth - 18);
    const minPosition = 9 + (range.min / 255) * trackWidth;
    const maxPosition = 9 + (range.max / 255) * trackWidth;
    el.minThumb.style.left = `${minPosition}px`;
    el.maxThumb.style.left = `${maxPosition}px`;
    el.fill.style.left = `${minPosition}px`;
    el.fill.style.width = `${maxPosition - minPosition}px`;
    el.minThumb.setAttribute('aria-valuenow', range.min);
    el.maxThumb.setAttribute('aria-valuenow', range.max);
}

function updatePanel() {
    const pc = pickedColor();
    const c = hovered || pc;
    mainSwatch.style.background = cssColor(c.r, c.g, c.b);
    mainRGB.textContent = `R ${c.r} · G ${c.g} · B ${c.b}`;
    mainHex.textContent = toHex(c.r, c.g, c.b);
    mainLabel.textContent = hovered ? '悬停中' : '当前范围';
    mainLabel.classList.toggle('hovering', !!hovered);

    if (hovered) {
        hoverPosEl.textContent = `x ${hovered.x} · y ${hovered.y} · z ${hovered.z}`;
        hoverColorEl.textContent = `rgb(${hovered.r}, ${hovered.g}, ${hovered.b})`;
        hoverSwatchEl.style.background = cssColor(hovered.r, hovered.g, hovered.b);
    } else {
        hoverPosEl.textContent = '—';
        hoverColorEl.textContent = '—';
        hoverSwatchEl.style.background = '#000';
    }

    for (const key of ['r', 'g', 'b']) {
        const range = channelRanges[key];
        const el = channelUI[key];
        el.range.textContent = `${range.min} – ${range.max}`;
        renderRangeControl(key);
    }
}

function refresh() {
    updatePanel();
}

function clearHover() {
    if (!hovered) return;
    updateHover(null);
    refresh();
}

// ---------- 交互：仅模型表面取色，画布拖动旋转视角 ----------
let orbitState = null;
let pinchState = null;
let touchOrbitState = null;
let webkitGestureRadius = null;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', clearHover);
window.addEventListener('blur', clearHover);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearHover();
});

canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0 && e.button !== 2) return;
    setPointer(e);
    orbitState = { startX: e.clientX, startY: e.clientY, theta: spherical.theta, phi: spherical.phi, moved: false };
    canvas.style.cursor = 'grabbing';
});

window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    setPointer(e);
    if (orbitState) {
        const dx = e.clientX - orbitState.startX;
        const dy = e.clientY - orbitState.startY;
        if (Math.hypot(dx, dy) > 3) orbitState.moved = true;
        if (orbitState.moved) {
            spherical.theta = orbitState.theta - dx * 0.005;
            spherical.phi = clamp(orbitState.phi - dy * 0.005, 0.15, Math.PI - 0.15);
            updateCamera();
        }
    } else {
        if (e.pointerType === 'touch') return;
        const modelHit = getModelHit();
        updateHover(modelHit);
        canvas.style.cursor = modelHit ? 'crosshair' : 'default';
        refresh();
    }
});

window.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    orbitState = null;
    canvas.style.cursor = 'default';
});

window.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') return;
    orbitState = null;
});

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touches = Array.from(e.touches);
    if (touches.length >= 2) {
        const [first, second] = touches;
        const centerX = (first.clientX + second.clientX) / 2;
        const centerY = (first.clientY + second.clientY) / 2;
        setPointerPosition(centerX, centerY);
        const modelHit = getModelHit();
        pinchState = {
            distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
            radius: spherical.radius,
            target: target.clone(),
            focus: modelHit ? modelHit.point.clone() : target.clone(),
        };
        touchOrbitState = null;
        orbitState = null;
        return;
    }

    const touch = touches[0];
    if (touch) {
        touchOrbitState = {
            startX: touch.clientX,
            startY: touch.clientY,
            theta: spherical.theta,
            phi: spherical.phi,
            moved: false,
        };
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touches = Array.from(e.touches);
    if (touches.length >= 2 && pinchState) {
        const [first, second] = touches;
        const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        const zoomRatio = pinchState.distance / Math.max(1, distance);
        spherical.radius = clamp(pinchState.radius * zoomRatio, 2, 2000);
        target.lerpVectors(pinchState.focus, pinchState.target, zoomRatio);
        updateCamera();
        return;
    }

    if (touches.length === 1 && touchOrbitState) {
        const touch = touches[0];
        const dx = touch.clientX - touchOrbitState.startX;
        const dy = touch.clientY - touchOrbitState.startY;
        if (Math.hypot(dx, dy) > 3) touchOrbitState.moved = true;
        if (touchOrbitState.moved) {
            spherical.theta = touchOrbitState.theta - dx * 0.005;
            spherical.phi = clamp(touchOrbitState.phi - dy * 0.005, 0.15, Math.PI - 0.15);
            updateCamera();
        }
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (pinchState) {
        pinchState = null;
        touchOrbitState = null;
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            touchOrbitState = {
                startX: touch.clientX,
                startY: touch.clientY,
                theta: spherical.theta,
                phi: spherical.phi,
                moved: true,
            };
        }
        return;
    }

    const shouldPick = touchOrbitState && !touchOrbitState.moved && e.changedTouches.length > 0;
    if (shouldPick) {
        const touch = e.changedTouches[0];
        setPointerPosition(touch.clientX, touch.clientY);
        updateHover(getModelHit());
        refresh();
    }
    touchOrbitState = null;
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    pinchState = null;
    touchOrbitState = null;
}, { passive: false });

canvas.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    webkitGestureRadius = spherical.radius;
}, { passive: false });

canvas.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (webkitGestureRadius && Number.isFinite(e.scale)) {
        spherical.radius = clamp(webkitGestureRadius / e.scale, 2, 2000);
        updateCamera();
    }
}, { passive: false });

canvas.addEventListener('gestureend', (e) => {
    e.preventDefault();
    webkitGestureRadius = null;
}, { passive: false });

const preventNativeGesture = (e) => e.preventDefault();
for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(eventName, preventNativeGesture, { capture: true, passive: false });
}

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setPointer(e);
    const modelHit = getModelHit();
    const focus = modelHit ? modelHit.point : target.clone();
    const previousRadius = spherical.radius;
    spherical.radius = clamp(previousRadius * (1 + e.deltaY * 0.001), 2, 2000);
    const zoomRatio = spherical.radius / previousRadius;
    if (modelHit) target.lerpVectors(focus, target, zoomRatio);
    updateCamera();
}, { passive: false });

// ---------- 尺寸 & 动画 ----------
function resize() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();
refresh();
