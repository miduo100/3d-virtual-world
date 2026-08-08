# Cross-Virtual-World User Character Migration and Resource Rendering Method, System, and Virtual Item Ownership Management Method — Defensive Technical Disclosure

---

## 1. Technical Field

The present invention relates to the technical fields of computer graphics, online gaming, distributed systems, and virtual reality/metaverse technologies, and more particularly to a cross-virtual-world user character migration and resource rendering method, a distributed virtual world federation system, and a cross-virtual-world virtual item ownership management method.

---

## 2. Background Art

With the advancement of virtual reality, online gaming, and metaverse technologies, users increasingly expect to freely migrate their digital identities and characters across different virtual worlds. However, existing technologies suffer from the following deficiencies:

1. **Isolation Between Virtual Worlds**: Traditional virtual world platforms typically adopt centralized architectures, where user accounts, character models, and virtual items cannot interoperate across different platforms. Users must repeatedly create identities and assets in different worlds.

2. **Difficulty in Reusing Cross-Platform Character Resources**: Different virtual worlds or character generation platforms (such as Mixamo, ReadyPlayerMe, VRoid, Blender, etc.) employ different bone naming conventions, model formats, and animation data formats, making it impossible to directly drive a character animation from one world on another world's skeleton.

3. **Cross-Origin Resource Loading Constraints**: Character 3D models, motion animations, and sound resources are typically stored as URLs in the source world. The target world faces cross-origin access restrictions when loading these resources.

4. **Data Residue and Privacy Risks**: Existing cross-world account synchronization approaches typically require the target world to persistently store the user's complete character configuration, resulting in user data being scattered across multiple worlds, increasing privacy leakage and data management costs.

5. **Unclear Virtual Item Ownership**: When a user teleports from their home world to another world and acquires virtual items there, there is no effective technical mechanism to determine where the items should belong and how to write them back across worlds.

Therefore, there is a need for a solution that enables secure, flexible, and low-residue character migration and resource rendering across multiple independently deployed virtual worlds.

---

## 3. Summary of the Invention

### 3.1 Technical Problem to Be Solved

The present invention aims to provide a cross-virtual-world user character migration and resource rendering method and system, solving the problems in the prior art of untrusted character migration between independent virtual worlds, incompatible animation skeletons, difficulties in cross-origin resource loading, data residue in target worlds, and inconvenient virtual item ownership management.

**Unitary Inventive Concept**: The various inventive aspects of the present invention (character migration and rendering, distributed federation system, and virtual item ownership management) are all built upon the same technical foundation, namely "establishing a decentralized trust relationship between multiple independently deployed virtual world nodes through public key exchange, and performing cross-domain resource loading and data invocation based on said trust relationship." The trusted cross-world transfer of character configuration information, the stateless rendering and driving of the target world, and the cross-domain write-back of user virtual items to the home world are all specific implementations of the above federation trust and cross-domain invocation mechanism in different application scenarios, are technically interrelated, share the same unitary inventive concept, and qualify for a combined patent application.

### 3.2 Technical Solution

According to a first aspect of the present invention, there is provided a cross-virtual-world user character migration and resource rendering method, comprising:

1. A source virtual world and a target virtual world perform a federation handshake by exchanging public keys to establish a bidirectional trust relationship;

2. The source virtual world, in response to a user's teleport request, generates a cross-world teleport token containing user character configuration information, said character configuration information including at least a character 3D model address, motion animation addresses, and bone mapping configuration, said cross-world teleport token being signed with the private key of the source virtual world;

3. The target virtual world receives the cross-world teleport token, verifies the token signature using the public key of the source virtual world, and extracts the character configuration information;

4. The target virtual world loads resources across domains according to the character 3D model address and the motion animation addresses, and retargets the motion animations onto the target skeleton of the target virtual world based on the bone mapping configuration, so as to render and drive the user character in the target virtual world.

Optionally, the character configuration information further includes a sound resource address and/or weapon attachment configuration.

Optionally, the cross-world teleport token further includes a random nonce, an issuer identifier, an audience identifier, and/or an expiration timestamp.

In a preferred embodiment, the target virtual world does not persist the character configuration information into a local database, and uses the character configuration information to render and drive the user character only during the user session.

According to a second aspect of the present invention, there is provided a distributed virtual world federation system, comprising a plurality of independently deployed virtual world nodes, said plurality of nodes including at least one source node and at least one target node; the source node is configured with a federation communication module, a character resource management module, and a token issuance module; the target node is configured with a federation communication module, a character resource management module, a bone mapping module, and an animation adaptation module.

According to a third aspect of the present invention, there is provided a cross-virtual-world virtual item ownership management method, comprising: recording a home world address at user registration; when a user teleports from the home world to a non-home world, the non-home world reads the user's inventory data from the home world via a remote interface; when the user acquires a virtual item in the non-home world, the non-home world writes the virtual item back to the home world via a cross-domain request.

The above three aspects all rely on the public key trust and cross-domain resource/data invocation mechanism between source and target worlds, forming a unified federation interoperability technical solution.

### 3.3 Advantageous Effects

Compared with the prior art, the present invention has the following advantageous effects:

1. **Decentralized Trusted Federation**: A trust relationship is established through direct public key exchange between independently deployed virtual world nodes, without requiring a third-party centralized certification authority.

2. **Stateless Secure Migration**: Character configuration information is carried in a one-time private-key-signed cross-world teleport token, and the target world can complete verification using only the source world's public key, avoiding long-term synchronization of sensitive account data across multiple worlds.

3. **Adaptive Animation Skeleton Retargeting**: Source motion animation data is retargeted to the target skeleton through bone mapping configuration, solving the problem of incompatible bone naming across different platforms such as Mixamo, ReadyPlayerMe, and VRoid.

4. **Low Residue, Strong Privacy**: The target world does not persistently store foreign character configuration information, using it only during the user session. Upon the user's departure, no character appearance, animation, weapon, or other data remains in the target world.

5. **Clear Virtual Item Ownership**: The home world address locking mechanism ensures that rewards acquired by the user in external worlds are ultimately written back to their registered home world, preventing item dispersion or loss.

---

## 4. Brief Description of the Drawings

- **FIG. 1**: Schematic diagram of the overall architecture of the distributed virtual world federation system of the present invention.
- **FIG. 2**: Flowchart of the cross-world character migration method of the present invention.
- **FIG. 3**: Schematic diagram of the data structure of the cross-world teleport token of the present invention.
- **FIG. 4**: Schematic diagram of bone mapping and animation retargeting of the present invention.
- **FIG. 5**: Flowchart of the home world virtual item ownership management method of the present invention.

**Drawing Guidelines (please generate black-and-white line drawings based on these and incorporate into the application):**

- **FIG. 1**: Draw multiple virtual world nodes (labeled "Source Node", "Target Node", optionally "Central World Node"), with arrowed lines between nodes representing four types of interactions: "Exchange Public Key/Handshake", "Teleport Token", "Cross-Domain Resource Loading", "Inventory Read/Write"; inside each node, use dashed boxes to list the Federation Communication Module, Character Resource Management Module, Token Issuance Module (source) / Bone Mapping Module, Animation Adaptation Module (target).

- **FIG. 2**: Top-down flowchart with steps corresponding to the four steps of claim 1: ① Federation handshake exchanging public keys; ② Source world generating signed token; ③ Target world verifying signature and extracting configuration; ④ Cross-domain loading + bone retargeting rendering and driving; also mark "Verification Failed / Loading Failed" branches.

- **FIG. 3**: Token data structure block diagram, divided into four groups: "User Information / Federation Information / Teleport Context / Security Fields", with nonce, issuer, audience, iat, exp listed under security fields.

- **FIG. 4**: Left-right comparison, left showing source platform bones (e.g., Mixamo naming), right showing target bones, with arrow mapping table in the middle connecting corresponding bones, labeled "Animation Retargeting".

- **FIG. 5**: Dual-node flowchart for home/non-home worlds, with steps corresponding to the three steps of claim 10: ① Recording home address; ② Reading inventory from home world upon teleport; ③ Cross-domain write-back to home world after acquiring items.

---

## 5. Detailed Description of Embodiments

To make the objectives, technical solutions, and advantages of the present invention clearer, the present invention will be further described in detail below with reference to the accompanying drawings.

### 5.1 Overall System Architecture

As shown in FIG. 1, the distributed virtual world federation system provided by the present invention comprises a plurality of independently deployed virtual world nodes. Each node can run on different physical servers, containers, or cloud instances, communicating via HTTP/HTTPS and WebSocket. Node types include:

- **Source Node**: The world where the user currently resides, responsible for initiating teleports and issuing cross-world teleport tokens.
- **Target Node**: The world the user wishes to travel to, responsible for verifying tokens, loading resources, and rendering characters.
- **Central World Node (optional)**: Responsible for world registration and discovery, assisting source and target nodes in establishing initial contact.

Each node is configured at the software level with the following modules:

- **Federation Communication Module**: Responsible for exchanging public keys, handshaking, status checking, and sending/receiving and signature verification of teleport tokens with other nodes. In the present invention, token issuance is performed by the source node's federation communication module using its held private key, and token verification is performed by the target node's federation communication module using the locally stored source node public key.
- **Character Resource Management Module**: Responsible for storing and providing URL references for character 3D models, motion animations, and sound resources.
- **Bone Mapping Module**: Responsible for normalizing character bone names from different sources and generating a mapping table from source bones to target bones.
- **Animation Adaptation Module**: Responsible for retargeting source motion animation data to the target skeleton according to the mapping table.
- **Token Issuance and Verification Support**: The private key held by the source node and the source node public key stored by the target node are established during the handshake phase by the federation communication module and used for token issuance and verification.

### 5.2 Federation Handshake and Trust Establishment

As shown in FIG. 2, before character migration, the source virtual world and the target virtual world first establish a bidirectional trust relationship by exchanging public keys. Each world node generates a pair of RSA public-private keys upon startup:

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

The source node sends a handshake request to the target node via the federation communication module, carrying its own world identifier, name, URL, and public key:

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

The target node receives the request during handshake processing and adds the source node to its trust list, while returning its own public key:

```js
handleHandshake(requestData) {
  const { worldId, worldName, worldUrl, publicKey } = requestData;
  if (!worldId || !worldName || !worldUrl || !publicKey) {
    return { success: false, error: 'Incomplete handshake data' };
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

Through the above handshake, the source node and target node each store the other's public key, and all subsequent cross-world teleport token issuance and verification are performed based on this trust relationship.

### 5.3 Cross-World Teleport Token Generation

When a user initiates a teleport request at the source node, the source node first retrieves the user information and character nickname:

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
    handleError(res, error, 'Failed to generate teleport token');
  }
});
```

Subsequently, the source node invokes the token generation logic to generate a JWT-format cross-world teleport token:

```js
async generateTeleportToken(user, targetWorldId, context = {}) {
  const targetWorld = this.trustedWorlds.get(targetWorldId);
  if (!targetWorld) throw new Error(`Untrusted target world: ${targetWorldId}`);
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

As shown in FIG. 3, the data structure of the cross-world teleport token includes:

- **User Information**: user identifier, username, character nickname, email, role permissions, avatar, etc.
- **Federation Information**: source world identifier, name, URL, target world identifier.
- **Teleport Context**: position, inventory, achievements, custom data, character configuration information, inventory API information, etc.
- **Security Fields**: issuance time `iat`, expiration time `exp`, random anti-replay nonce, issuer `issuer`, audience `audience`.

Therein, the character configuration information `characterConfig` is key to rendering the user character in the target world, including at least:

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

- `glbUrl`: character 3D model address;
- `animUrls`: collection of motion animation addresses, such as idle, walk, run, attack, etc.;
- `boneMapConfig`: bone mapping configuration;
- `weaponSocketConfig`: weapon attachment configuration;
- `calibrationConfig`: calibration configuration;
- `weaponConfig`: weapon appearance configuration;
- `templateName`, `modelHeight`: template name and model height;
- `sourceWorldUrl`: source world address, used to convert relative URLs to absolute URLs.

Optionally, the character configuration information further includes a sound resource address, which may come from the `sound_url` field in the animation library table, or from the weapon sound configuration `weapon_sounds`.

### 5.4 Target World Reception and Verification

The target node receives the cross-world teleport token via a reception interface:

```js
router.post('/teleport/receive', securityCheck, async (req, res) => {
  try {
    const { teleportToken } = req.body;
    if (!teleportToken) {
      return res.status(400).json({ success: false, error: 'Please provide a teleport token' });
    }
    const verifyResult = await federationSystem.verifyTeleportToken(teleportToken);
    if (!verifyResult.success) {
      return res.status(401).json(verifyResult);
    }
    const { user, context } = verifyResult;
    // ...
  } catch (error) {
    handleError(res, error, 'Failed to receive teleported user');
  }
});
```

The verification process first decodes the token to obtain the source world identifier, then retrieves the source world's public key from the local trust list, and verifies the signature using the RS256 algorithm:

```js
async verifyTeleportToken(token) {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) throw new Error('Invalid token format');
    const sourceWorldId = decoded.payload.iss;
    const sourceWorld = this.trustedWorlds.get(sourceWorldId);
    if (!sourceWorld) throw new Error(`Untrusted source world: ${sourceWorldId}`);
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

After successful verification, the target node locally finds or creates a user account and default character:

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

In a preferred embodiment, after verification and extraction of the character configuration information, the target node does not persist said character configuration information into a local database, but instead returns it directly to the frontend:

```js
res.json({
  success: true,
  message: `Welcome ${user.username} from ${user.fromWorld.name}!`,
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

The frontend writes `characterConfig` to local session storage (such as `localStorage`), and the target world server does not retain this configuration:

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

After the user session ends, the target world no longer holds the user's foreign character appearance, animations, bone mappings, or other data, thereby achieving low residue and strong privacy.

### 5.5 Cross-Origin Resource Loading

Since character models, animations, and sound resources are typically hosted in directories such as `public/models` and `public/animations` of the source world, the target world requires cross-origin access when loading these resources. To this end, each world node configures a Cross-Origin Resource Sharing (CORS) policy in its HTTP service, allowing other worlds with established trust relationships to load resources.

The source node, when generating `characterConfig`, converts relative URLs to absolute URLs prefixed with the source world's domain name:

```js
let glbUrl = rawGlb
  ? (rawGlb.startsWith('http') ? rawGlb : window.location.origin + rawGlb)
  : null;
```

The target world frontend uses loaders such as Three.js's `GLTFLoader` to make cross-origin requests and load GLB models and animation files according to the absolute URLs.

### 5.6 Bone Mapping and Animation Retargeting

As shown in FIG. 4, different character generation platforms (Mixamo, ReadyPlayerMe, VRoid, Blender, etc.) may name the same bone differently. For example, Mixamo uses `mixamorig:RightArm`, while another platform may use `RightArm` or `Arm_R`. The bone mapping module generates a mapping table from source bones to target bones based on the source platform identifier and target model structure:

```js
function retargetAnimationClip(clip, sourcePlatformId, targetModel) {
  if (!clip || !clip.tracks || clip.tracks.length === 0) return clip;
  const sourceConfig = getPlatformConfig(sourcePlatformId);
  // ...
}
```

After loading animations, the target world invokes the animation adaptation module to retarget the animation clips:

```js
let clip = gltf.animations[0];
if (window.AnimRetargetHelper) {
  clip = window.AnimRetargetHelper.processAnimClip(clip, model, type) || clip;
}
```

Through the above bone mapping and animation retargeting, the source world's motion animation data can be correctly played on the target world's character skeleton.

### 5.7 Character Rendering and Driving

The target world frontend creates a character group via the `addPlayer` method and asynchronously loads the GLB model:

```js
addPlayer(characterId, characterName, position = { x: 0, y: 0, z: 0 },
          isLoggedIn = true, glbUrl = null, weaponConfig = null,
          boneMapConfig = null, weaponSocketConfig = null, calibrationConfig = null) {
  this.removePlayer(characterId);
  // ...
}
```

After loading is complete, the target world drives the character animation based on a shared animation mixer `sharedMixer`:

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

The weapon attachment configuration specifies the weapon's attachment point on the character's skeleton via `weaponSocketConfig`, and the target world attaches the weapon model to the corresponding bone accordingly.

**Loading Failure Fallback (corresponding to claim 7)**: During the cross-origin loading of GLB models or motion animations, in the event of a loading failure such as network timeout, resource 404, or parsing exception, the target world catches the exception and uses a built-in local default placeholder model to render the user character, ensuring that the character is at least visible and drivable in a basic form in the target world, and switches to the full model when the network recovers or resources become available. This fallback mechanism does not depend on successful loading of source world resources, thereby improving the robustness of cross-world migration.

### 5.8 Home World Item Ownership Management

As shown in FIG. 5, the present invention further provides a cross-virtual-world virtual item ownership management method. Each user's home world address `homeWorldApiUrl` is recorded at registration. When a user teleports from the home world to a non-home world, the source world carries the home world information in the `inventoryInfo` of the cross-world teleport token:

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

After login, the target world frontend preferentially reads inventory data from the home world:

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

When the user acquires a virtual item in a non-home world, the target world employs a two-step mechanism:

1. Mark the dropped item as picked up in the current world (without writing to local inventory);
2. Invoke the home world's remote write interface via a cross-domain request to write the reward back to the home world.

```js
// Auto-pickup of drops and write to inventory (home world mode):
// Step 1 - Call the current world's mark-picked to mark world_drops as picked up (without writing player_inventory)
// Step 2 - Call the home world's remote-add to write the reward to the player_inventory of the world where the player is registered
```

The home world's remote write interface verifies the caller's identity and then writes the reward to the player's inventory:

```js
// POST /api/inventory/remote-add  Cross-world remote write to inventory (home world mode: rewards transferred from external world back to home world)
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

Through the above mechanism, virtual items acquired by the user in external worlds always belong to their registered home world and will not be dispersed or lost due to cross-world migration.

### 5.9 Security Mechanisms

The security mechanisms of the present invention primarily include:

1. **Public Key Infrastructure**: Each world node independently generates an RSA key pair, and public keys are exchanged through handshakes to establish a decentralized trust relationship.

2. **JWT Signing and Verification**: Cross-world teleport tokens are signed using the RS256 algorithm, and the target world verifies using the source world's public key, preventing token forgery.

3. **Token Field Constraints**: The token includes the issuer `issuer`, audience `audience`, expiration time `exp`, and random `nonce`. The target world enforces verification of these fields, preventing replay attacks and cross-target abuse.

4. **Transport Security**: Both handshake and teleport interfaces are transmitted over HTTPS, and some interfaces require the source node to provide a security verification header.

---

> **Document Note**: This document constitutes a Defensive Publication, intended to place the above technical solutions into the prior art to prevent third parties from obtaining patent rights over the same technical solutions. All technical content described in this document became publicly available prior art as of the date of publication of this repository.
