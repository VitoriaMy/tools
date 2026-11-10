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
// 模型局部坐标 [0, 1] -> 通道值 [0, 255]
const coordToChannel = (c, max) => Math.round(clamp(c, 0, 1) * max);
const MAX_SIZE = 256;
const valueToSize = (v) => v + 1;
const axisHeadOffset = (size) => Math.max(0.12, size * 0.04);
const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
const cssColor = (r, g, b) => `rgb(${r}, ${g}, ${b})`;

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
    uniforms: { uMaxColor: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: `
        varying vec3 vLocalPos;
        void main() {
            vLocalPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: `
        uniform vec3 uMaxColor;
        varying vec3 vLocalPos;
        void main() {
            vec3 c = clamp(vLocalPos, 0.0, 1.0) * uMaxColor;
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
        uniform vec3 uMaxColor;
        varying vec3 vLocalPos;
        void main() {
            vec3 surfaceColor = clamp(vLocalPos, 0.0, 1.0) * uMaxColor;
            gl_FragColor = vec4(vec3(1.0) - surfaceColor, 1.0);
        }`
});

// ---------- 主模型：RGB 值直接控制 X/Y/Z 尺寸 ----------
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
cubeGeometry.translate(0.5, 0.5, 0.5);
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
cube.scale.setScalar(valueToSize(255));
scene.add(cube);

const cubeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    cubeEdgeMaterial
);
cube.add(cubeEdges);

// ---------- 视图内 RGB 尺寸手柄 ----------
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

const handles = {};
for (const key of Object.keys(channelDefs)) {
    const def = channelDefs[key];
    const material = new THREE.MeshBasicMaterial({ color: def.color, depthTest: true });
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), material);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
    group.add(shaft, tip);
    group.traverse(object => {
        if (object.isMesh) {
            object.material = material;
            object.renderOrder = 8;
            object.userData.key = key;
        }
    });
    scene.add(group);
    handles[key] = { def, group, shaft, tip, material, value: 255 };
}

function updateAxisGeometry(key) {
    const { mesh, def } = axes[key];
    const value = handles[key].value;
    const size = valueToSize(value);
    const axisLength = size + axisHeadOffset(size);
    const direction = def.direction;
    const tickDirection = def.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const points = [new THREE.Vector3(), direction.clone().multiplyScalar(axisLength)];

    for (let tick = 0; tick <= value; tick += 32) {
        const tickPoint = direction.clone().multiplyScalar(valueToSize(tick));
        const halfLength = tick === value ? Math.max(0.08, size * 0.008) : Math.max(0.06, size * 0.006);
        points.push(tickPoint.clone().addScaledVector(tickDirection, -halfLength));
        points.push(tickPoint.clone().addScaledVector(tickDirection, halfLength));
    }
    if (value % 32 !== 0) {
        const endPoint = direction.clone().multiplyScalar(size);
        const halfLength = Math.max(0.08, size * 0.008);
        points.push(endPoint.clone().addScaledVector(tickDirection, -halfLength));
        points.push(endPoint.clone().addScaledVector(tickDirection, halfLength));
    }

    const oldGeometry = mesh.geometry;
    mesh.geometry = new THREE.BufferGeometry().setFromPoints(points);
    oldGeometry.dispose();
}

function updateModelAndHandles(updateView = true, fitCamera = updateView) {
    for (const key of ['r', 'g', 'b']) {
        cube.scale[channelDefs[key].axis] = valueToSize(handles[key].value);
    }
    cubeMaterial.uniforms.uMaxColor.value.set(
        handles.r.value / 255,
        handles.g.value / 255,
        handles.b.value / 255
    );
    const modelScale = Math.max(cube.scale.x, cube.scale.y, cube.scale.z);
    for (const key of ['r', 'g', 'b']) {
        const handle = handles[key];
        const direction = handle.def.direction;
        const size = cube.scale[handle.def.axis];
        const headOffset = axisHeadOffset(size);
        const start = direction.clone().multiplyScalar(size);
        const end = direction.clone().multiplyScalar(size + headOffset);
        const shaftRadius = Math.max(0.03, modelScale * 0.006);
        const tipRadius = Math.max(0.05, modelScale * 0.015);
        handle.shaft.position.copy(start).add(end).multiplyScalar(0.5);
        handle.shaft.scale.set(shaftRadius, start.distanceTo(end), shaftRadius);
        handle.shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        handle.tip.position.copy(end);
        handle.tip.scale.setScalar(tipRadius);
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
updateModelAndHandles();

function pickedColor() {
    return {
        r: handles.r.value,
        g: handles.g.value,
        b: handles.b.value,
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
let hoveredHandle = null;

const hoverTargets = [cube];

function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function setHoveredHandle(key) {
    if (hoveredHandle === key) return;
    if (hoveredHandle) {
        const previous = handles[hoveredHandle];
        previous.material.color.setHex(previous.def.color);
    }
    hoveredHandle = key;
    if (hoveredHandle) handles[hoveredHandle].material.color.setHex(0xffffff);
}

function getPointerHits() {
    raycaster.setFromCamera(pointer, camera);
    const axisHit = raycaster.intersectObjects(handleTargets, false)[0];
    const modelHit = raycaster.intersectObjects(hoverTargets, false)[0];
    return {
        axisHit: axisHit && (!modelHit || axisHit.distance <= modelHit.distance) ? axisHit : null,
        modelHit,
    };
}

function updateHover(hit) {
    if (hit) {
        const p = cube.worldToLocal(hit.point.clone());
        const r = coordToChannel(p.x, handles.r.value);
        const g = coordToChannel(p.y, handles.g.value);
        const b = coordToChannel(p.z, handles.b.value);
        hovered = { r, g, b, x: r, y: g, z: b };
        const faceNormal = hit.face.normal;
        const faceCenter = new THREE.Vector3(
            (r + 0.5) / cube.scale.x,
            (g + 0.5) / cube.scale.y,
            (b + 0.5) / cube.scale.z
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
            <span class="num"></span>
            <span class="range">尺寸</span>
        </div>
        <input type="range" class="value-slider" min="0" max="255" step="1">`;
    channelsEl.appendChild(wrap);

    const el = channelUI[key] = {
        value: wrap.querySelector('.num'),
        range: wrap.querySelector('.range'),
        valueSlider: wrap.querySelector('.value-slider'),
    };

    el.valueSlider.addEventListener('input', () => {
        handles[key].value = Number(el.valueSlider.value);
        updateModelAndHandles();
        refresh();
    });
}

function updatePanel() {
    const pc = pickedColor();
    const c = hovered || pc;
    mainSwatch.style.background = cssColor(c.r, c.g, c.b);
    mainRGB.textContent = `R ${c.r} · G ${c.g} · B ${c.b}`;
    mainHex.textContent = toHex(c.r, c.g, c.b);
    mainLabel.textContent = hovered ? '悬停中' : hoveredHandle ? `${handles[hoveredHandle].def.tag}轴调整` : '当前选中';
    mainLabel.classList.toggle('hovering', !!hovered);
    mainLabel.classList.toggle('axis-hovering', !!hoveredHandle);

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
        const v = handles[key].value;
        const el = channelUI[key];
        el.value.textContent = v;
        el.range.textContent = `尺寸 ${valueToSize(v)}`;
        el.valueSlider.value = v;
    }
}

function refresh() {
    updatePanel();
}

// ---------- 交互：拖拽轴手柄调整尺寸 / 空白处旋转视角 ----------
let dragging = null;
let orbitState = null; // 旋转视角
const dragPoint = new THREE.Vector3();
const dragAxis = new THREE.Vector3();
const dragPlane = new THREE.Plane();
const dragStartPoint = new THREE.Vector3();
const dragStartTarget = new THREE.Vector3();
const dragStartValue = { value: 0 };
const handleTargets = Object.values(handles).flatMap(handle => [handle.shaft, handle.tip]);

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1) return;
    setPointer(e);
    const axisHit = e.button === 0 ? getPointerHits().axisHit : null;
    if (axisHit) {
        dragging = axisHit.object.userData.key;
        setHoveredHandle(dragging);
        const handle = handles[dragging];
        dragAxis.copy(handle.def.direction);
        const viewDirection = camera.getWorldDirection(new THREE.Vector3());
        let planeNormal = viewDirection.clone().addScaledVector(dragAxis, -viewDirection.dot(dragAxis));
        if (planeNormal.lengthSq() < 1e-6) planeNormal.copy(camera.up);
        dragPlane.setFromNormalAndCoplanarPoint(planeNormal.normalize(), axisHit.point);
        if (raycaster.ray.intersectPlane(dragPlane, dragStartPoint)) {
            dragStartValue.value = handle.value;
            dragStartTarget.copy(target);
        } else {
            dragging = null;
        }
        hovered = null;
        hoverBox.visible = false;
    } else {
        setHoveredHandle(null);
        orbitState = { startX: e.clientX, startY: e.clientY, theta: spherical.theta, phi: spherical.phi };
    }
    canvas.style.cursor = 'grabbing';
});

window.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (dragging) {
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            const pointerDelta = dragPoint.clone().sub(dragStartPoint).dot(dragAxis);
            const targetDelta = target.clone().sub(dragStartTarget).dot(dragAxis);
            const valueDelta = (pointerDelta - targetDelta) * 2;
            handles[dragging].value = clamp(Math.round(dragStartValue.value + valueDelta), 0, 255);
            updateModelAndHandles(true, false);
            refresh();
        }
    } else if (orbitState) {
        const dx = e.clientX - orbitState.startX;
        const dy = e.clientY - orbitState.startY;
        spherical.theta = orbitState.theta - dx * 0.005;
        spherical.phi = clamp(orbitState.phi - dy * 0.005, 0.15, Math.PI - 0.15);
        updateCamera();
    } else {
        const { axisHit, modelHit } = getPointerHits();
        if (axisHit) {
            setHoveredHandle(axisHit.object.userData.key);
            hovered = null;
            hoverBox.visible = false;
            canvas.style.cursor = 'grab';
            updateHover(null);
        } else {
            setHoveredHandle(null);
            updateHover(modelHit);
            canvas.style.cursor = modelHit ? 'crosshair' : 'default';
        }
        refresh();
    }
});

window.addEventListener('pointerup', () => {
    if (dragging) dragging = null;
    if (orbitState) orbitState = null;
    setHoveredHandle(null);
    canvas.style.cursor = 'default';
    refresh();
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setPointer(e);
    const { axisHit, modelHit } = getPointerHits();
    const focus = axisHit
        ? handles[axisHit.object.userData.key].tip.getWorldPosition(new THREE.Vector3())
        : modelHit ? modelHit.point : target.clone();
    const previousRadius = spherical.radius;
    spherical.radius = clamp(previousRadius * (1 + e.deltaY * 0.001), 2, 2000);
    const zoomRatio = spherical.radius / previousRadius;
    if (axisHit || modelHit) target.lerpVectors(focus, target, zoomRatio);
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
