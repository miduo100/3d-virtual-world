# 跨虚拟世界的用户角色迁移与资源渲染方法、系统及虚拟物品归属管理方法 — 防御性技术公开文档

---

## 一、技术领域

本发明涉及计算机图形学、网络游戏、分布式系统以及虚拟现实/元宇宙技术领域，尤其涉及一种跨虚拟世界的用户角色迁移与资源渲染方法、一种分布式虚拟世界联邦系统，以及一种跨虚拟世界虚拟物品归属管理方法。

---

## 二、背景技术

随着虚拟现实、网络游戏和元宇宙技术的发展，用户期望在不同的虚拟世界之间自由迁移自己的数字身份和角色。然而，现有技术存在以下缺陷：

1. **虚拟世界之间彼此孤立**：传统虚拟世界平台通常采用中心化架构，不同平台之间的用户账号、角色模型、虚拟物品无法互通，用户在不同世界需重复创建身份与资产。

2. **跨平台角色资源难以复用**：不同虚拟世界或角色生成平台（如 Mixamo、ReadyPlayerMe、VRoid、Blender 等）使用的骨骼命名规范、模型格式、动画数据格式存在差异，导致一个世界中的角色动画无法直接在另一个世界中驱动。

3. **跨域资源加载受限**：角色三维模型、动作动画、声音资源通常以 URL 形式存储在源世界中，目标世界在加载这些资源时面临跨域访问限制。

4. **数据残留与隐私风险**：现有跨世界账号同步方案往往要求目标世界持久化存储用户的完整角色配置，导致用户数据散落在多个世界中，增加隐私泄露和数据管理成本。

5. **虚拟物品归属不清**：当用户从家园世界传送到其他世界并在那里获得虚拟物品时，物品应归属于何处、如何跨世界回写，缺乏有效的技术机制。

因此，需要一种能够在多个独立部署的虚拟世界之间实现安全、灵活、低残留的角色迁移与资源渲染方案。

---

## 三、发明内容

### 3.1 要解决的技术问题

本发明旨在提供一种跨虚拟世界的用户角色迁移与资源渲染方法及系统，解决现有技术中独立虚拟世界之间角色无法可信迁移、动画骨骼不兼容、跨域资源加载困难、目标世界数据残留以及虚拟物品归属管理不便的问题。

**总发明构思**：本发明各发明方面（角色迁移与渲染、分布式联邦系统、虚拟物品归属管理）共同建立于同一技术基础之上，即"在多个独立部署的虚拟世界节点之间通过交换公钥建立去中心化信任关系，并基于该信任关系进行跨域的资源加载与数据调用"。角色配置信息的跨世界可信传递、目标世界的无状态渲染驱动、以及用户虚拟物品向家园世界的跨域回写，均是上述联邦信任与跨域调用机制在不同应用场景下的具体实现，彼此在技术上相互关联、共享同一核心发明构思，符合合案申请的要求。

### 3.2 技术方案

根据本发明的第一方面，提供一种跨虚拟世界的用户角色迁移与资源渲染方法，包括：

1. 源虚拟世界与目标虚拟世界通过交换公钥进行联邦握手，建立双向信任关系；

2. 所述源虚拟世界响应用户的传送请求，生成包含用户角色配置信息的跨世界传送令牌，所述角色配置信息至少包括角色三维模型地址、动作动画地址以及骨骼映射配置，所述跨世界传送令牌由所述源虚拟世界的私钥签名；

3. 所述目标虚拟世界接收所述跨世界传送令牌，使用所述源虚拟世界的公钥验证令牌签名，并提取所述角色配置信息；

4. 所述目标虚拟世界根据所述角色三维模型地址和所述动作动画地址跨域加载资源，并基于所述骨骼映射配置将所述动作动画重定向到所述目标虚拟世界的目标骨骼上，以在所述目标虚拟世界中渲染并驱动所述用户角色。

可选地，所述角色配置信息还包括声音资源地址和/或武器挂载配置。

可选地，所述跨世界传送令牌还包括随机数 nonce、签发者标识、接收者标识和/或过期时间戳。

在一优选实施例中，所述目标虚拟世界不将所述角色配置信息持久化到本地数据库，仅在用户会话期间使用所述角色配置信息渲染和驱动所述用户角色。

根据本发明的第二方面，提供一种分布式虚拟世界联邦系统，包括多个独立部署的虚拟世界节点，所述多个节点中包括至少一个源节点和至少一个目标节点；所述源节点配置有联邦通信模块、角色资源管理模块和令牌签发模块；所述目标节点配置有联邦通信模块、角色资源管理模块、骨骼映射模块和动画适配模块。

根据本发明的第三方面，提供一种跨虚拟世界虚拟物品归属管理方法，包括：记录用户注册的家园世界地址；当用户从所述家园世界传送到非家园世界时，所述非家园世界通过远程接口从所述家园世界读取所述用户的背包数据；当用户在所述非家园世界获得虚拟物品时，所述非家园世界通过跨域请求将所述虚拟物品回写到所述家园世界。

上述三方面均依托源—目标世界的公钥信任与跨域资源/数据调用机制实现，构成统一的联邦互通技术方案。

### 3.3 有益效果

与现有技术相比，本发明具有以下有益效果：

1. **去中心化可信联邦**：通过独立部署的虚拟世界节点之间直接交换公钥建立信任关系，无需依赖第三方中心化认证机构。

2. **无状态安全迁移**：利用私钥签名的跨世界传送令牌一次性携带角色配置信息，目标世界通过源世界公钥即可完成验证，避免在多个世界之间长期同步敏感账号数据。

3. **动画骨骼自适应**：通过骨骼映射配置将源动作动画数据重定向到目标骨骼，解决 Mixamo、ReadyPlayerMe、VRoid 等不同平台骨骼命名不兼容的问题。

4. **低残留、强隐私**：目标世界不持久化外来角色配置信息，仅在用户会话期间使用，用户离开后不会在目标世界留下角色外观、动画、武器等数据。

5. **虚拟物品归属清晰**：通过家园世界地址锁定机制，确保用户在外部世界获得的奖励最终回写到其注册的家园世界，避免物品分散或丢失。

---

## 四、附图说明

- **图 1**：本发明分布式虚拟世界联邦系统的整体架构示意图。
- **图 2**：本发明跨世界角色迁移方法的流程图。
- **图 3**：本发明跨世界传送令牌的数据结构示意图。
- **图 4**：本发明骨骼映射与动画重定向的示意图。
- **图 5**：本发明家园世界虚拟物品归属管理方法的流程图。

**附图绘制指引（请据此另行生成黑白线条图后并入本申请）：**

- **图 1**：画出多个虚拟世界节点（标注"源节点""目标节点"，可选"中央世界节点"），节点间用带箭头连线表示"交换公钥/握手""传送令牌""跨域资源加载""背包读写"四类交互；各节点内部以虚线框列出联邦通信模块、角色资源管理模块、令牌签发模块（源）/骨骼映射模块、动画适配模块（目标）。
- **图 2**：自上而下流程图，步骤对应权利要求 1 四步：①联邦握手交换公钥；②源世界生成签名令牌；③目标世界验签提取配置；④跨域加载+骨骼重定向渲染驱动；并标注"验证失败/加载失败"分支。
- **图 3**：令牌数据结构框图，分"用户信息/联邦信息/传送上下文/安全字段"四组，安全字段下列 nonce、issuer、audience、iat、exp。
- **图 4**：左右对比，左为源平台骨骼（如 Mixamo 命名），右为目标骨骼，中间箭头映射表连接对应骨骼，标注"动画重定向"。
- **图 5**：家园/非家园双节点流程图，步骤对应权利要求 10 三步：①记录家园地址；②传送时从家园读背包；③获得物品后跨域回写家园。

---

## 五、具体实施方式

为使本发明的目的、技术方案和优点更加清楚，下面将结合附图对本发明作进一步地详细描述。

### 5.1 系统整体架构

如图 1 所示，本发明提供的分布式虚拟世界联邦系统包括多个独立部署的虚拟世界节点。每个节点可运行在不同的物理服务器、容器或云实例中，通过 HTTP/HTTPS 和 WebSocket 进行通信。节点类型包括：

- **源节点**：用户当前所在的世界，负责发起传送、签发跨世界传送令牌。
- **目标节点**：用户希望前往的世界，负责验证令牌、加载资源、渲染角色。
- **中央世界节点（可选）**：负责世界注册与发现，协助源节点和目标节点建立初始联系。

每个节点在软件层面配置有以下模块：

- **联邦通信模块**：负责与其他节点交换公钥、握手、状态检查以及传送令牌的收发与签名验证。在本发明中，令牌的签发由源节点的联邦通信模块调用其持有的私钥完成，令牌的验证由目标节点的联邦通信模块使用本地保存的源节点公钥完成。
- **角色资源管理模块**：负责存储和提供角色三维模型、动作动画、声音资源的 URL 引用。
- **骨骼映射模块**：负责规范化不同来源的角色骨骼名称并生成源骨骼到目标骨骼的映射表。
- **动画适配模块**：负责根据所述映射表将源动作动画数据重定向到目标骨骼。
- **令牌签发与验证支撑**：源节点持有的私钥、目标节点保存的源节点公钥，由联邦通信模块在握手阶段建立并用于令牌的签发与验证。

### 5.2 联邦握手与信任建立

如图 2 所示，源虚拟世界与目标虚拟世界在角色迁移之前先通过交换公钥建立双向信任关系。每个世界节点在启动时生成一对 RSA 公私钥：

```js
static generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey, privateKey };
}
```

源节点通过联邦通信模块向目标节点发送握手请求，携带自身的世界标识、名称、URL 和公钥：

```js
async establishTrust(targetWorldUrl) {
  try {
    targetWorldUrl = targetWorldUrl.replace(/\/+$/, '');
    const response = await axios.post(`${targetWorldUrl}/api/federation/handshake`, {
      worldId: this.worldId,
      worldName: this.worldName,
      worldUrl: this.worldUrl,
      publicKey: this.publicKey
    }, { headers: { 'Content-Type': 'application/json' } });
    if (response.data.success) {
      this.trustWorld(
        response.data.worldId,
        response.data.worldName,
        response.data.worldUrl,
        response.data.publicKey
      );
      // ...
    }
  } catch (error) {
    // ...
  }
}
```

目标节点在握手处理中接收请求并将源节点加入信任列表，同时返回自身的公钥：

```js
handleHandshake(requestData) {
  const { worldId, worldName, worldUrl, publicKey } = requestData;
  if (!worldId || !worldName || !worldUrl || !publicKey) {
    return { success: false, error: '握手数据不完整' };
  }
  this.trustWorld(worldId, worldName, worldUrl, publicKey);
  return {
    success: true,
    worldId: this.worldId,
    worldName: this.worldName,
    worldUrl: this.worldUrl,
    publicKey: this.publicKey
  };
}
```

通过上述握手，源节点和目标节点各自保存了对方的公钥，后续所有跨世界传送令牌的签发与验证均基于该信任关系完成。

### 5.3 跨世界传送令牌生成

当用户在源节点发起传送请求时，源节点首先获取用户信息和角色昵称：

```js
router.post('/teleport/generate', authenticateToken, securityCheck, async (req, res) => {
  try {
    const { targetWorldId, context } = req.body;
    // ...
    const userResult = await query(
      'SELECT id, username, email, role FROM users WHERE id = $1',
      [req.user.userId]
    );
    // ...
    const teleportToken = await federationSystem.generateTeleportToken(
      user, targetWorldId, context
    );
    // ...
  } catch (error) {
    handleError(res, error, '生成传送Token失败');
  }
});
```

随后，源节点调用令牌生成逻辑生成 JWT 格式的跨世界传送令牌：

```js
async generateTeleportToken(user, targetWorldId, context = {}) {
  const targetWorld = this.trustedWorlds.get(targetWorldId);
  if (!targetWorld) throw new Error(`未信任的目标世界: ${targetWorldId}`);
  const payload = {
    userId: user.id,
    username: user.username,
    characterName: user.characterName || user.username,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    sourceWorldId: this.worldId,
    sourceWorldName: this.worldName,
    sourceWorldUrl: this.worldUrl,
    targetWorldId: targetWorldId,
    context: {
      position:        context.position        || { x: 0, y: 0, z: 0 },
      inventory:       context.inventory       || [],
      achievements:    context.achievements    || [],
      customData:      context.customData      || {},
      characterConfig: context.characterConfig || null,
      inventoryInfo:   context.inventoryInfo   || null
    },
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  const token = jwt.sign(payload, this.privateKey, {
    algorithm: 'RS256',
    issuer: this.worldId,
    audience: targetWorldId
  });
  return token;
}
```

如图 3 所示，所述跨世界传送令牌的数据结构包括：

- **用户信息**：用户标识、用户名、角色昵称、邮箱、角色权限、头像等。
- **联邦信息**：源世界标识、名称、URL，目标世界标识。
- **传送上下文**：位置、背包、成就、自定义数据、角色配置信息、背包 API 信息等。
- **安全字段**：签发时间 `iat`、过期时间 `exp`、随机防重放 nonce、签发者 `issuer`、接收者 `audience`。

其中，角色配置信息 `characterConfig` 是渲染目标世界用户角色的关键，至少包括：

```js
characterConfig: {
  glbUrl,
  animUrls,
  weaponConfig,
  boneMapConfig,
  weaponSocketConfig,
  calibrationConfig,
  templateName:   localStorage.getItem('selectedTemplateName') || '',
  modelHeight:    localStorage.getItem('selectedTemplateHeight') || '1.8',
  sourceWorldUrl: window.location.origin
}
```

- `glbUrl`：角色三维模型地址；
- `animUrls`：动作动画地址集合，如 idle、walk、run、attack 等；
- `boneMapConfig`：骨骼映射配置；
- `weaponSocketConfig`：武器挂载配置；
- `calibrationConfig`：校准配置；
- `weaponConfig`：武器外观配置；
- `templateName`、`modelHeight`：模板名称和模型高度；
- `sourceWorldUrl`：源世界地址，用于将相对 URL 转换为绝对 URL。

可选地，角色配置信息还包括声音资源地址，所述声音资源地址可来自动作库表中的 `sound_url` 字段，或来自武器音效配置 `weapon_sounds`。

### 5.4 目标世界接收与验证

目标节点通过接收接口接收跨世界传送令牌：

```js
router.post('/teleport/receive', securityCheck, async (req, res) => {
  try {
    const { teleportToken } = req.body;
    if (!teleportToken) {
      return res.status(400).json({ success: false, error: '请提供传送Token' });
    }
    const verifyResult = await federationSystem.verifyTeleportToken(teleportToken);
    if (!verifyResult.success) {
      return res.status(401).json(verifyResult);
    }
    const { user, context } = verifyResult;
    // ...
  } catch (error) {
    handleError(res, error, '接收传送用户失败');
  }
});
```

验证过程首先解码令牌获取源世界标识，然后从本地信任列表中取得源世界公钥，再使用 RS256 算法验证签名：

```js
async verifyTeleportToken(token) {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) throw new Error('无效的Token格式');
    const sourceWorldId = decoded.payload.iss;
    const sourceWorld = this.trustedWorlds.get(sourceWorldId);
    if (!sourceWorld) throw new Error(`未信任的源世界: ${sourceWorldId}`);
    const verified = jwt.verify(token, sourceWorld.publicKey, {
      algorithms: ['RS256'],
      issuer: sourceWorldId,
      audience: this.worldId
    });
    // ...
  } catch (error) {
    // ...
  }
}
```

验证通过后，目标节点在本地查找或创建用户账户和默认角色：

```js
let localUser;
const existingUserResult = await query(
  'SELECT * FROM users WHERE email = $1', [user.email]
);
if (existingUserResult.rows.length === 0) {
  const insertResult = await query(
    `INSERT INTO users (id, username, email, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [uuidv4(), user.username, user.email, 'FEDERATED_USER']
  );
  localUser = insertResult.rows[0];
} else {
  localUser = existingUserResult.rows[0];
}
// ...
const newCharResult = await query(
  `INSERT INTO characters
    (user_id, name, level, health, max_health, attack_power, defense, experience, position, respawn_point, created_at, updated_at)
   VALUES ($1, $2, 1, 100, 100, 10, 5, 0, $3, $3, NOW(), NOW()) RETURNING *`,
  [localUser.id, displayName, JSON.stringify({ x: 0, y: 0, z: 0 })]
);
```

在一优选实施例中，目标节点在验证和提取角色配置信息后，不将所述角色配置信息持久化到本地数据库，而是直接返回给前端：

```js
res.json({
  success: true,
  message: `欢迎来自 ${user.fromWorld.name} 的 ${user.username}！`,
  token: localToken,
  user: {
    id: localUser.id,
    username: localUser.username,
    email: localUser.email,
    role: localUser.role,
    characterId: localCharacter.id
  },
  context,
  characterConfig: context.characterConfig || null,
  inventoryInfo:   context.inventoryInfo   || null
});
```

前端将 `characterConfig` 写入本地会话存储（如 `localStorage`），目标世界服务器不保留该配置：

```js
const cc = data.characterConfig;
if (cc) {
  if (cc.glbUrl)             localStorage.setItem('selectedTemplateGlbUrl',       cc.glbUrl);
  if (cc.templateName)       localStorage.setItem('selectedTemplateName',         cc.templateName);
  if (cc.modelHeight)        localStorage.setItem('selectedTemplateHeight',       cc.modelHeight);
  if (cc.boneMapConfig)      localStorage.setItem('selectedTemplateBoneMap',      JSON.stringify(cc.boneMapConfig));
  if (cc.weaponSocketConfig) localStorage.setItem('selectedTemplateWeaponSocket', JSON.stringify(cc.weaponSocketConfig));
  if (cc.calibrationConfig)  localStorage.setItem('selectedTemplateCalibration',  JSON.stringify(cc.calibrationConfig));
  if (cc.weaponConfig)       localStorage.setItem('selectedTemplateWeaponConfig', JSON.stringify(cc.weaponConfig));
  if (cc.animUrls) {
    ANIM_KEYS.forEach(k => {
      if (cc.animUrls[k]) localStorage.setItem('selectedTemplateAnim_' + k, cc.animUrls[k]);
    });
  }
}
```

用户会话结束后，目标世界不再持有该用户的外来角色外观、动画、骨骼映射等数据，实现了低残留、强隐私。

### 5.5 跨域资源加载

由于角色模型、动画、声音资源通常托管在源世界的 `public/models`、`public/animations` 等目录下，目标世界在加载这些资源时需要跨域访问。为此，各世界节点在 HTTP 服务中配置跨域资源共享（CORS）策略，允许已建立信任关系的其他世界加载资源。

源节点在生成 `characterConfig` 时，将相对 URL 转换为以源世界域名开头的绝对 URL：

```js
let glbUrl = rawGlb
  ? (rawGlb.startsWith('http') ? rawGlb : window.location.origin + rawGlb)
  : null;
```

目标世界前端使用 Three.js 的 `GLTFLoader` 等加载器，根据绝对 URL 跨域请求并加载 GLB 模型和动画文件。

### 5.6 骨骼映射与动画重定向

如图 4 所示，不同角色生成平台（Mixamo、ReadyPlayerMe、VRoid、Blender 等）对同一骨骼的命名可能不同。例如，Mixamo 使用 `mixamorig:RightArm`，而另一平台可能使用 `RightArm` 或 `Arm_R`。骨骼映射模块根据源平台标识和目标模型结构生成源骨骼到目标骨骼的映射表：

```js
function retargetAnimationClip(clip, sourcePlatformId, targetModel) {
  if (!clip || !clip.tracks || clip.tracks.length === 0) return clip;
  const sourceConfig = getPlatformConfig(sourcePlatformId);
  // ...
}
```

目标世界在加载动画后，调用动画适配模块对动画剪辑进行重定向：

```js
let clip = gltf.animations[0];
if (window.AnimRetargetHelper) {
  clip = window.AnimRetargetHelper.processAnimClip(clip, model, type) || clip;
}
```

通过上述骨骼映射与动画重定向，源世界的动作动画数据能够在目标世界的角色骨骼上正确播放。

### 5.7 角色渲染与驱动

目标世界前端通过 `addPlayer` 方法创建角色组，并异步加载 GLB 模型：

```js
addPlayer(characterId, characterName, position = { x: 0, y: 0, z: 0 },
          isLoggedIn = true, glbUrl = null, weaponConfig = null,
          boneMapConfig = null, weaponSocketConfig = null, calibrationConfig = null) {
  this.removePlayer(characterId);
  // ...
}
```

加载完成后，目标世界基于共享动画混合器 `sharedMixer` 驱动角色动画：

```js
const _processAnimClip = (gltf) => {
  if (!characterGroup.userData.animMixers) characterGroup.userData.animMixers = {};
  if (!characterGroup.userData.animActions) characterGroup.userData.animActions = {};
  let sharedMixer = characterGroup.userData.sharedMixer;
  if (!sharedMixer) {
    let mixerRoot = model;
    model.traverse(n => { if (n.type === 'Object3D' && n.children.some(c => c.isBone)) mixerRoot = n; });
    sharedMixer = new THREE.AnimationMixer(mixerRoot);
    characterGroup.userData.sharedMixer = sharedMixer;
  }
  // ...
};
```

武器挂载配置则通过 `weaponSocketConfig` 指定武器在角色骨骼上的挂载点，目标世界据此将武器模型附加到对应骨骼。

**加载失败回退（对应权利要求 7）**：在跨域加载 GLB 模型或动作动画的过程中，若发生网络超时、资源 404 或解析异常等加载失败情形，目标世界捕获该异常，并使用内置的本地默认占位模型（placeholder）渲染所述用户角色，以保证角色至少以基础形态在目标世界中可见、可被驱动，待网络恢复或资源可用时再切换至完整模型。该回退机制不依赖源世界资源的成功加载，从而提升跨世界迁移的鲁棒性。

### 5.8 家园世界物品归属管理

如图 5 所示，本发明还提供一种跨虚拟世界虚拟物品归属管理方法。每个用户注册时记录其家园世界地址 `homeWorldApiUrl`。当用户从家园世界传送到非家园世界时，源世界在跨世界传送令牌的 `inventoryInfo` 中携带家园世界信息：

```js
inventoryInfo: {
  apiBaseUrl: window.location.origin,
  userId:     localStorage.getItem('userId'),
  token:      token,
  homeWorldApiUrl:  localStorage.getItem('homeWorldApiUrl')  || window.location.origin,
  homeWorldUserId:  localStorage.getItem('homeWorldUserId')  || localStorage.getItem('userId'),
  homeWorldToken:   localStorage.getItem('homeWorldToken')   || token
}
```

目标世界前端登录后，优先从家园世界读取背包数据：

```js
async function loadInventoryData() {
  try {
    const homeWorldApiUrl = localStorage.getItem('homeWorldApiUrl');
    const homeWorldUserId = localStorage.getItem('homeWorldUserId');
    const homeWorldToken  = localStorage.getItem('homeWorldToken');
    // ...
    if (homeWorldApiUrl && homeWorldUserId) {
      apiUrl       = `${homeWorldApiUrl}/api/inventory/bag/${homeWorldUserId}`;
      fetchOptions = homeWorldToken ? { headers: { 'Authorization': `Bearer ${homeWorldToken}` } } : {};
      // ...
    }
  }
}
```

当用户在非家园世界获得虚拟物品时，目标世界采用两步机制：

1. 在当前世界标记掉落物已被拾取（不写本地背包）；
2. 通过跨域请求调用家园世界的远程写入接口，将奖励回写到家园世界。

```js
// 自动拾取掉落物并写入背包（家园世界模式）：
// 步骤1 - 调用当前世界 mark-picked，标记 world_drops 已拾取（不写 player_inventory）
// 步骤2 - 调用家园世界 remote-add，把奖励写入玩家注册的那个世界的 player_inventory
```

家园世界的远程写入接口验证调用者身份后，将奖励写入玩家背包：

```js
// POST /api/inventory/remote-add  跨世界远程写入背包（家园世界模式：奖励从外部世界回传到家园世界）
router.post('/remote-add', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { homeUserId, rewardName, rewardDesc, code, platformUrl, sourceWorldUrl } = req.body;
    // ...
    const result = await query(
      `INSERT INTO player_inventory (id, user_id, code_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, code_id) DO NOTHING`,
      [invId, homeUserId, codeId]
    );
    // ...
  } catch (e) {
    // ...
  }
});
```

通过上述机制，用户在外部世界获得的虚拟物品始终归属于其注册的家园世界，不会因跨世界迁移而分散或丢失。

### 5.9 安全机制

本发明的安全机制主要包括：

1. **公钥基础设施**：每个世界节点独立生成 RSA 密钥对，通过握手交换公钥，建立去中心化信任关系。

2. **JWT 签名与验证**：跨世界传送令牌采用 RS256 算法签名，目标世界使用源世界公钥验证，防止令牌伪造。

3. **令牌字段约束**：令牌中包含签发者 `issuer`、接收者 `audience`、过期时间 `exp` 和随机 `nonce`，目标世界在验证时强制校验这些字段，防止重放攻击和跨目标滥用。

4. **传输安全**：握手和传送接口均通过 HTTPS 传输，并在部分接口中要求源节点提供安全校验头。

---

> **文件说明**：本文档为防御性技术公开（Defensive Publication），旨在将上述技术方案纳入现有技术（Prior Art），以防止第三方就相同技术方案获得专利权。本文档所述的全部技术内容已于本仓库公开之日成为公共领域的技术公开。
