/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 主场景地块同步：读取 /api/world/ground-config 配置，
 * 将游戏世界（world.js 中 setupTerrain 创建的主地面）调整到与编辑器一致的大小。
 * 注意：world.js 为黑名单大文件，此处不改动它，仅通过场景对象动态调整。
 */
(function () {
    'use strict';

    const GROUND_API = '/api/world/ground-config';

    // 查找主场景中 setupTerrain 创建的地面：
    // PlaneGeometry 且旋转了 -90°（rotation.x = -Math.PI / 2）
    function findMainGround(scene) {
        if (!scene || !scene.children) return null;
        for (let i = 0; i < scene.children.length; i++) {
            const child = scene.children[i];
            if (child && child.isMesh && child.geometry &&
                child.geometry.type === 'PlaneGeometry' &&
                Math.abs(child.rotation.x + Math.PI / 2) < 0.01) {
                return child;
            }
        }
        return null;
    }

    function applyConfig(cfg) {
        const gw = window.gameWorld;
        if (!gw || !gw.scene) return;
        const ground = findMainGround(gw.scene);
        if (!ground) return;

        // 仅替换 geometry，保持 mesh 引用不变（matrixAutoUpdate=false 需手动刷新矩阵）
        if (!ground.geometry ||
            ground.geometry.parameters.width !== cfg.width ||
            ground.geometry.parameters.depth !== cfg.depth) {
            ground.geometry = new THREE.PlaneGeometry(cfg.width, cfg.depth);
            ground.updateMatrix();
            console.log(`[ground-sync] 主地块已同步为 ${cfg.width} × ${cfg.depth}`);
        }
    }

    async function sync() {
        try {
            const res = await fetch(GROUND_API, { cache: 'no-store' });
            const data = await res.json();
            if (data.success && data.config) applyConfig(data.config);
        } catch (e) {
            console.warn('[ground-sync] 同步地块配置失败:', e);
        }
    }

    // 轮询：gameWorld 出现或重建（刷新/登录）时应用一次配置
    let lastSyncedWorld = null;
    setInterval(() => {
        const gw = window.gameWorld;
        if (gw && gw.scene && lastSyncedWorld !== gw) {
            lastSyncedWorld = gw;
            sync();
        }
    }, 1000);
})();
