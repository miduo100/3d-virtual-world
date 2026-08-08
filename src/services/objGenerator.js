/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * OBJ几何体生成服务
 * 根据AI理解的模型描述生成OBJ文件内容
 */

class OBJGenerator {
  /**
   * 生成简单的几何体OBJ
   * @param {string} geometryType - 几何体类型 (box, cylinder, sphere, cone, pyramid等)
   * @param {object} properties - 几何体属性
   * @returns {string} OBJ文件内容
   */
  generateGeometryOBJ(geometryType, properties = {}) {
    const {
      width = 2,
      height = 2,
      depth = 2,
      radius = 1,
      segments = 16,
      color = '#888888'
    } = properties;

    switch (geometryType.toLowerCase()) {
      case 'box':
      case 'cube':
        return this.generateBoxOBJ(width, height, depth);
      
      case 'cylinder':
        return this.generateCylinderOBJ(radius, height, segments);
      
      case 'sphere':
        return this.generateSphereOBJ(radius, segments);
      
      case 'cone':
        return this.generateConeOBJ(radius, height, segments);
      
      case 'pyramid':
        return this.generatePyramidOBJ(width, height);
      
      case 'house':
      case 'cottage':
        return this.generateHouseOBJ(width, height, depth);
      
      case 'tower':
        return this.generateTowerOBJ(radius, height, segments);
      
      case 'tree':
        return this.generateTreeOBJ(height, radius);
      
      case 'chick':
      case 'chicken':
      case 'hen':
        return this.generateChickOBJ(width || 1);
      
      default:
        return this.generateBoxOBJ(width, height, depth);
    }
  }

  /**
   * 生成立方体OBJ
   */
  generateBoxOBJ(width, height, depth) {
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;

    return `# Box Model
# Width: ${width}, Height: ${height}, Depth: ${depth}
o Box

# Vertices
v -${w} -${h} ${d}
v ${w} -${h} ${d}
v ${w} ${h} ${d}
v -${w} ${h} ${d}
v -${w} -${h} -${d}
v ${w} -${h} -${d}
v ${w} ${h} -${d}
v -${w} ${h} -${d}

# Normals
vn 0 0 1
vn 0 0 -1
vn 0 1 0
vn 0 -1 0
vn 1 0 0
vn -1 0 0

# Faces
# Front
f 1//1 2//1 3//1
f 1//1 3//1 4//1
# Back
f 6//2 5//2 8//2
f 6//2 8//2 7//2
# Top
f 4//3 3//3 7//3
f 4//3 7//3 8//3
# Bottom
f 5//4 6//4 2//4
f 5//4 2//4 1//4
# Right
f 2//5 6//5 7//5
f 2//5 7//5 3//5
# Left
f 5//6 1//6 4//6
f 5//6 4//6 8//6
`;
  }

  /**
   * 生成圆柱体OBJ
   */
  generateCylinderOBJ(radius, height, segments) {
    let obj = '# Cylinder Model\n';
    obj += `# Radius: ${radius}, Height: ${height}, Segments: ${segments}\n`;
    obj += 'o Cylinder\n\n';

    const h = height / 2;
    let vertices = [];
    let faces = [];

    // 生成顶部和底部的顶点
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      
      vertices.push({ x, y: h, z });  // 顶部
      vertices.push({ x, y: -h, z }); // 底部
    }

    // 中心点
    vertices.push({ x: 0, y: h, z: 0 });  // 顶部中心
    vertices.push({ x: 0, y: -h, z: 0 }); // 底部中心

    // 写入顶点
    obj += '# Vertices\n';
    vertices.forEach(v => {
      obj += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
    });

    obj += '\n# Normals\n';
    obj += 'vn 0 1 0\nvn 0 -1 0\n';

    obj += '\n# Faces\n';
    const topCenter = vertices.length - 1;
    const bottomCenter = vertices.length;

    // 侧面
    for (let i = 0; i < segments; i++) {
      const v1 = i * 2 + 1;
      const v2 = i * 2 + 2;
      const v3 = ((i + 1) * 2) % (segments * 2) + 1;
      const v4 = ((i + 1) * 2) % (segments * 2) + 2;
      
      obj += `f ${v1} ${v3} ${v4}\n`;
      obj += `f ${v1} ${v4} ${v2}\n`;
    }

    // 顶部
    for (let i = 0; i < segments; i++) {
      const v1 = i * 2 + 1;
      const v2 = ((i + 1) * 2) % (segments * 2) + 1;
      obj += `f ${topCenter} ${v1} ${v2}\n`;
    }

    // 底部
    for (let i = 0; i < segments; i++) {
      const v1 = i * 2 + 2;
      const v2 = ((i + 1) * 2) % (segments * 2) + 2;
      obj += `f ${bottomCenter} ${v2} ${v1}\n`;
    }

    return obj;
  }

  /**
   * 生成球体OBJ
   */
  generateSphereOBJ(radius, segments) {
    let obj = '# Sphere Model\n';
    obj += `# Radius: ${radius}, Segments: ${segments}\n`;
    obj += 'o Sphere\n\n';

    let vertices = [];

    // 生成顶点
    for (let lat = 0; lat <= segments; lat++) {
      const theta = (lat * Math.PI) / segments;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      for (let lon = 0; lon <= segments; lon++) {
        const phi = (lon * 2 * Math.PI) / segments;
        const x = radius * Math.cos(phi) * sinTheta;
        const y = radius * cosTheta;
        const z = radius * Math.sin(phi) * sinTheta;
        
        vertices.push({ x, y, z });
      }
    }

    // 写入顶点
    obj += '# Vertices\n';
    vertices.forEach(v => {
      obj += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
    });

    obj += '\n# Faces\n';

    // 生成面
    for (let lat = 0; lat < segments; lat++) {
      for (let lon = 0; lon < segments; lon++) {
        const first = lat * (segments + 1) + lon + 1;
        const second = first + segments + 1;
        
        obj += `f ${first} ${second} ${first + 1}\n`;
        obj += `f ${second} ${second + 1} ${first + 1}\n`;
      }
    }

    return obj;
  }

  /**
   * 生成圆锥OBJ
   */
  generateConeOBJ(radius, height, segments) {
    let obj = '# Cone Model\n';
    obj += `# Radius: ${radius}, Height: ${height}, Segments: ${segments}\n`;
    obj += 'o Cone\n\n';

    let vertices = [];

    // 顶点
    vertices.push({ x: 0, y: height, z: 0 });

    // 底部圆形顶点
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      vertices.push({ x, y: 0, z });
    }

    // 底部中心点
    vertices.push({ x: 0, y: 0, z: 0 });

    // 写入顶点
    obj += '# Vertices\n';
    vertices.forEach(v => {
      obj += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
    });

    obj += '\n# Faces\n';

    // 侧面
    for (let i = 1; i <= segments; i++) {
      const v1 = 1;  // 顶点
      const v2 = i + 1;
      const v3 = (i % segments) + 2;
      obj += `f ${v1} ${v2} ${v3}\n`;
    }

    // 底部
    const center = vertices.length;
    for (let i = 1; i <= segments; i++) {
      const v1 = i + 1;
      const v2 = (i % segments) + 2;
      obj += `f ${center} ${v2} ${v1}\n`;
    }

    return obj;
  }

  /**
   * 生成金字塔OBJ
   */
  generatePyramidOBJ(base, height) {
    const b = base / 2;
    return `# Pyramid Model
# Base: ${base}, Height: ${height}
o Pyramid

# Vertices
v 0 ${height} 0
v -${b} 0 ${b}
v ${b} 0 ${b}
v ${b} 0 -${b}
v -${b} 0 -${b}

# Faces
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 2
f 2 5 4
f 2 4 3
`;
  }

  /**
   * 生成简单房子OBJ
   */
  generateHouseOBJ(width, height, depth) {
    const w = width / 2;
    const h = height;
    const d = depth / 2;
    const roofH = height + height * 0.4;

    return `# House Model
# Width: ${width}, Height: ${height}, Depth: ${depth}
o House

# Vertices
# Base box
v -${w} 0 ${d}
v ${w} 0 ${d}
v ${w} ${h} ${d}
v -${w} ${h} ${d}
v -${w} 0 -${d}
v ${w} 0 -${d}
v ${w} ${h} -${d}
v -${w} ${h} -${d}
# Roof peak
v 0 ${roofH} ${d}
v 0 ${roofH} -${d}

# Faces
# Front wall
f 1 2 3
f 1 3 4
# Back wall
f 6 5 8
f 6 8 7
# Right wall
f 2 6 7
f 2 7 3
# Left wall
f 5 1 4
f 5 4 8
# Front roof
f 4 3 9
# Back roof
f 7 8 10
# Right roof
f 3 7 10
f 3 10 9
# Left roof
f 8 4 9
f 8 9 10
`;
  }

  /**
   * 生成塔楼OBJ
   */
  generateTowerOBJ(radius, height, segments) {
    // 塔楼是多层圆柱体叠加
    let obj = '# Tower Model\n';
    obj += 'o Tower\n\n';

    let vertices = [];
    const layers = 5;
    const layerHeight = height / layers;

    for (let layer = 0; layer <= layers; layer++) {
      const y = layer * layerHeight;
      const r = radius * (1 - layer * 0.05); // 逐渐变窄

      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = r * Math.cos(angle);
        const z = r * Math.sin(angle);
        vertices.push({ x, y, z });
      }
    }

    obj += '# Vertices\n';
    vertices.forEach(v => {
      obj += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
    });

    obj += '\n# Faces\n';

    for (let layer = 0; layer < layers; layer++) {
      for (let i = 0; i < segments; i++) {
        const base = layer * (segments + 1) + 1;
        const v1 = base + i;
        const v2 = base + i + 1;
        const v3 = base + segments + 1 + i + 1;
        const v4 = base + segments + 1 + i;
        
        obj += `f ${v1} ${v2} ${v3}\n`;
        obj += `f ${v1} ${v3} ${v4}\n`;
      }
    }

    return obj;
  }

  /**
   * 生成树OBJ
   */
  generateTreeOBJ(height, radius) {
    const trunkH = height * 0.3;
    const trunkR = radius * 0.2;
    const crownH = height * 0.7;
    const crownR = radius;

    return `# Tree Model
o Tree

# Trunk (cylinder)
v 0 0 0
${this.generateCylinderVertices(trunkR, trunkH, 8).map(v => `v ${v}`).join('\n')}

# Crown (cone)
${this.generateConeVertices(crownR, crownH, trunkH, 8).map(v => `v ${v}`).join('\n')}

# Trunk faces
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 2

# Crown faces
f 6 7 8
f 6 8 9
f 6 9 10
f 6 10 7
`;
  }

  // 辅助方法
  generateCylinderVertices(radius, height, segments) {
    const vertices = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      vertices.push(`${x.toFixed(4)} 0 ${z.toFixed(4)}`);
      vertices.push(`${x.toFixed(4)} ${height.toFixed(4)} ${z.toFixed(4)}`);
    }
    return vertices;
  }

  generateConeVertices(radius, height, baseY, segments) {
    const vertices = [];
    vertices.push(`0 ${(baseY + height).toFixed(4)} 0`);
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      vertices.push(`${x.toFixed(4)} ${baseY.toFixed(4)} ${z.toFixed(4)}`);
    }
    return vertices;
  }

  /**
   * 生成小鸡OBJ（可爱的几何体组合）
   * 包含：身体（椭圆体）、头部（小球）、喙（三角锥）、眼睛、脚
   */
  generateChickOBJ(scale = 1) {
    const bodyW = 0.8 * scale;
    const bodyH = 1.0 * scale;
    const bodyD = 0.7 * scale;
    
    const headR = 0.4 * scale;
    const headY = bodyH * 0.6;
    
    const beakL = 0.15 * scale;
    const legH = 0.3 * scale;
    const legR = 0.08 * scale;

    return `# Chick Model
# Cute geometric chick
o Chick

# Body vertices (ellipsoid - simplified as stretched sphere)
v 0 0 ${bodyD}
v ${bodyW} 0 0
v 0 0 -${bodyD}
v -${bodyW} 0 0
v 0 ${bodyH} ${bodyD * 0.7}
v ${bodyW * 0.7} ${bodyH} 0
v 0 ${bodyH} -${bodyD * 0.7}
v -${bodyW * 0.7} ${bodyH} 0
v 0 ${bodyH * 0.5} 0

# Head vertices (sphere at top)
v 0 ${headY + bodyH} ${headR}
v ${headR} ${headY + bodyH} 0
v 0 ${headY + bodyH} -${headR}
v -${headR} ${headY + bodyH} 0
v 0 ${headY + bodyH + headR} 0

# Beak vertices (small cone)
v ${beakL} ${headY + bodyH} ${headR * 1.2}
v 0 ${headY + bodyH + 0.05} ${headR * 1.5}
v 0 ${headY + bodyH - 0.05} ${headR * 1.5}

# Left leg vertices
v -${bodyW * 0.3} 0 ${bodyD * 0.3}
v -${bodyW * 0.3} -${legH} ${bodyD * 0.3}

# Right leg vertices
v ${bodyW * 0.3} 0 ${bodyD * 0.3}
v ${bodyW * 0.3} -${legH} ${bodyD * 0.3}

# Normals
vn 0 1 0
vn 0 -1 0
vn 1 0 0
vn -1 0 0
vn 0 0 1
vn 0 0 -1

# Body faces (simplified ellipsoid)
# Bottom
f 1 2 9
f 2 3 9
f 3 4 9
f 4 1 9

# Top
f 5 6 14
f 6 7 14
f 7 8 14
f 8 5 14

# Sides
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8

# Head faces (simplified sphere)
f 10 11 14
f 11 12 14
f 12 13 14
f 13 10 14

f 10 11 9
f 11 12 9
f 12 13 9
f 13 10 9

# Beak (triangle)
f 15 16 17

# Legs
f 18 19 9
f 20 21 9
`;
  }
}

module.exports = new OBJGenerator();
