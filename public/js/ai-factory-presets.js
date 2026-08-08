/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * AI动作工厂 - 动作预设配置数据
 * 包含18个动作的完整配置：默认提示词、时长、强度、快捷模板
 */

// ===== 动作分类定义 =====
const MOTION_CATEGORIES = {
    locomotion: { 
        icon: '🚶', 
        title: '基础移动', 
        desc: '角色基础位移动画',
        color: '#4CAF50'
    },
    turning: { 
        icon: '🔄', 
        title: '转向', 
        desc: '身体朝向变更',
        color: '#2196F3'
    },
    combat_single: { 
        icon: '⚔️', 
        title: '单体攻击', 
        desc: '单次独立攻击动作',
        color: '#FF5722'
    },
    combo: { 
        icon: '🔗', 
        title: '连击', 
        desc: '多段连续攻击组合',
        color: '#9C27B0'
    },
    weapon_state: { 
        icon: '🗡️', 
        title: '武器&状态', 
        desc: '武器交互与状态变化',
        color: '#607D8B'
    }
};

// ===== 全部18个动作配置 =====
const MOTION_PRESETS = [
    // ========== 基础移动 (4) ==========
    {
        key: 'idle',
        category: 'locomotion',
        displayName: '待机',
        emoji: '💤',
        isEssential: true,
        sortOrder: 1,
        defaultDuration: 3.0,
        intensity: 'weak',
        defaultPrompt: '角色站立原地待机，轻微自然呼吸起伏（胸部起伏约2厘米），双手自然垂于身体两侧微微晃动，头部偶尔左右微转5-10度观察周围，重心在双脚间均匀分布。整体节奏缓慢放松，像是在等待指令的状态。起始和结束都保持自然站立姿势。',
        templates: [
            { name: '标准待机', prompt: null },
            { name: '战斗戒备', prompt: '角色保持警戒姿态站立，双脚略微分开宽于肩，膝盖微曲，双手置于身前或武器附近准备状态，头部警觉地扫视周围，重心略低随时准备行动。' },
            { name: '放松休闲', prompt: '角色放松站立，重心偏向一条腿（每2秒换腿），双手可能叉腰或背在身后，偶尔打哈欠或挠头，整体慵懒随意。' }
        ]
    },
    {
        key: 'walk',
        category: 'locomotion',
        displayName: '走路',
        emoji: '🚶',
        isEssential: true,
        sortOrder: 2,
        defaultDuration: 2.0,
        intensity: 'weak',
        defaultPrompt: '角色以正常步行速度向前行走，步伐稳健沉稳，步幅约等于肩宽。双臂自然前后摆动（摆动幅度约20-30度），与对侧腿协调交替。躯干轻微随步伐上下起伏约3-5厘米，头部保持水平稳定目视前方。整个循环可无缝衔接，适合作为行走循环动画。',
        templates: [
            { name: '标准行走', prompt: null },
            { name: '潜行蹑足', prompt: '角色小心翼翼地潜行，脚步轻放脚跟到脚尖缓慢过渡，上半身前倾压低重心，双臂收紧贴身减小摆动幅度，头部不时观察四周，整体节奏缓慢安静。' },
            { name: '大步疾行', prompt: '角色大步流星般快速行走，步幅加大到1.5倍肩宽，双臂大幅度摆动带动身体节奏，上身略微前倾有目的性方向感。' }
        ]
    },
    {
        key: 'run',
        category: 'locomotion',
        displayName: '奔跑',
        emoji: '🏃',
        isEssential: true,
        sortOrder: 3,
        defaultDuration: 1.5,
        intensity: 'strong',
        defaultPrompt: '角色全速奔跑，身体明显前倾约15-20度，步幅大幅增加至肩宽的1.5倍以上。双腿快速交替蹬地离地瞬间有明显的腾空期（每步约0.1-0.15秒）。双臂用力前后大幅度摆动（约45-60度弧度）驱动身体前进。头部稳定朝向奔跑方向。整体充满动感和力量感。',
        templates: [
            { name: '全速冲刺', prompt: null },
            { name: '耐力慢跑', prompt: '角色以中等配速慢跑，步幅适中，腾空期较短，双臂较小幅度摆动节省体力，呼吸节奏均匀，适合长距离持续奔跑的姿态。' },
            { name: '紧急逃亡', prompt: '角色惊慌失措地拼命奔跑，上身过度前倾几乎要摔倒，手臂杂乱摆动，步伐不规则忽快忽慢，头部不断回头看，表现出极度紧张恐惧的状态。' }
        ]
    },
    {
        key: 'jump',
        category: 'locomotion',
        displayName: '跳跃',
        emoji: '🦘',
        isEssential: true,
        sortOrder: 4,
        defaultDuration: 0.8,
        intensity: 'strong',
        defaultPrompt: '角色完成一个标准的垂直起跳过程：①蓄力阶段-双膝弯曲下蹲，手臂向后预摆；②起跳爆发-双腿猛力蹬地伸展，手臂向上挥摆带动身体腾空；③空中最高点-身体完全舒展呈直线，双腿并拢或微曲，手臂举高；④落地缓冲-双脚触地后膝盖深度弯曲吸收冲击，手臂向下压平衡身体，最后恢复直立。整个过程流畅有力。',
        templates: [
            { name: '原地跳跃', prompt: null },
            { name: '前冲跳远', prompt: '角色向前方跳跃，起跳时有明显的前冲速度感，空中身体呈弓形向前延伸，落地时向前滚动一步缓冲距离，整体位移感强。' },
            { name: '二段跳', prompt: '角色执行二段跳跃：第一次起跳后在最高点再次蹬腿产生第二段腾空，第二段比第一段略低但增加了滞空时间，手臂配合二次挥舞。' }
        ]
    },

    // ========== 转向 (2) ==========
    {
        key: 'turn_left',
        category: 'turning',
        displayName: '左转',
        emoji: '↩️',
        isEssential: false,
        sortOrder: 5,
        defaultDuration: 1.2,
        intensity: 'weak',
        defaultPrompt: '角色从面向正前方平滑转向左侧90度。以左脚为轴心脚固定在地面上，右脚抬起到左脚前方交叉迈出同时身体旋转，上半身先于下肢开始转动引导方向。双臂自然配合转向做出轻微摆动保持平衡。头部跟随身体转动方向平移视线。整个过程在1-1.5秒内完成。',
        templates: [
            { name: '标准转身', prompt: null },
            { name: '急速转向', prompt: '角色快速向左急转，以脚掌为轴快速旋转身体，可能有轻微的身体倾斜离心感，双臂张开辅助平衡，转头迅速视线先于身体到达目标方向。' },
            { name: '战斗侧步', prompt: '角色保持面向敌人方向不变的情况下，通过侧向小碎步向左横向移动调整站位，始终保持戒备姿态，脚步轻盈快速。' }
        ]
    },
    {
        key: 'turn_right',
        category: 'turning',
        displayName: '右转',
        emoji: '↪️',
        isEssential: false,
        sortOrder: 6,
        defaultDuration: 1.2,
        intensity: 'weak',
        defaultPrompt: '角色从面向正前方平滑转向右侧90度。以右脚为轴心脚固定在地面上，左脚抬起到右脚前方交叉迈出同时身体旋转，上半身先于下肢开始转动引导方向。双臂自然配合转向做出轻微摆动保持平衡。头部跟随身体转动方向平移视线。整个过程在1-1.5秒内完成。',
        templates: [
            { name: '标准转身', prompt: null },
            { name: '急速转向', prompt: '角色快速向右急转，以脚掌为轴快速旋转身体，可能有轻微的身体倾斜离心感，双臂张开辅助平衡，转头迅速视线先于身体到达目标方向。' },
            { name: '战斗侧步', prompt: '角色保持面向敌人方向不变的情况下，通过侧向小碎步向右横向移动调整站位，始终保持戒备姿态，脚步轻盈快速。' }
        ]
    },

    // ========== 单体攻击 (5) ==========
    {
        key: 'attack_normal',
        category: 'combat_single',
        displayName: '普通攻击',
        emoji: '⚔️',
        isEssential: true,
        sortOrder: 7,
        defaultDuration: 2.0,
        intensity: 'medium',
        defaultPrompt: '角色进行一次标准的正面普通攻击动作序列：①预备姿势-重心微降进入攻击准备态，持械手后拉蓄力，非持械手前伸保持平衡；②攻击发动-持械手沿弧线轨迹由后向前挥砍或刺出，腰部发力带动上半身旋转参与攻击；③攻击延伸-手臂完全伸展到达最远点，身体重心随之前倾；④回收复位-攻击手臂收回恢复预备姿势。整个动作干净利落有力量感。',
        templates: [
            { name: '单手剑·直劈', prompt: '角色右手持单手剑从头顶正前方垂直向下劈砍，剑刃走直线轨迹，身体随之下沉再回升，左手握拳置于腰间辅助平衡，劈砍到底后有轻微余震反馈。' },
            { name: '单手剑·横扫', prompt: '角色右手持剑从身体右侧水平向左横扫180度弧线，腰部大力转动带动手臂，剑尖划出半圆轨迹，身体随旋转有惯性偏转。' },
            { name: '双手大剑·重劈', prompt: '角色双手持大型武器高举过头顶，全身力量汇聚向下猛烈劈砍，整个身体从下蹲蓄力到全力跃起劈下，落点有沉重感冲击力。' }
        ]
    },
    {
        key: 'attack_stab',
        category: 'combat_single',
        displayName: '刺',
        emoji: '🗡️',
        isEssential: true,
        sortOrder: 8,
        defaultDuration: 1.2,
        intensity: 'medium',
        defaultPrompt: '角色执行一次快速直刺攻击：①预备-后撤半步拉开距离，持械手收到腰侧蓄力，身体略微侧转将非持械侧朝向目标；②突刺-持械手臂迅猛向前直线刺出，手腕保持稳定使武器尖端精确指向目标，后腿蹬地推动重心前移；③延伸-刺击到达最大深度点，手臂完全伸直锁定；④收回-快速沿来路抽回武器，身体后撤恢复间距回到预备姿态。动作特点是快速、直接、精准。',
        templates: [
            { name: '中距直刺', prompt: null },
            { name: '近距离突刺', prompt: '角色极近距离下突然出手直刺，几乎无预备动作，纯靠手臂爆发力向前刺出，速度极快但威力相对较小，适合近身缠斗中的突然一击。' },
            { name: '跳跃穿刺', prompt: '角色向前跳跃的同时在空中将武器向前刺出，利用全身前冲动能增强穿刺力，落地后顺势向前滑步缓冲。' }
        ]
    },
    {
        key: 'attack_chop',
        category: 'combat_single',
        displayName: '砍',
        emoji: '🪓',
        isEssential: true,
        sortOrder: 9,
        defaultDuration: 2.0,
        intensity: 'strong',
        defaultPrompt: '角色执行一次强力下砍攻击：①蓄力-双手或单手高举武器超过头顶，身体后仰拉开空间，后腿弯曲承重；②下劈-全身力量从腿部→腰部→背部→肩部→手臂逐节传递，武器沿斜下方猛烈劈下，身体随之前倾下沉；③劈中-武器到达最低点，全身重量灌注到命中点，有明显的砸下去的厚重感，双膝弯曲吸收反作用力；④收招-保持低位片刻然后起身。动作特点：大开大合，力量感十足。',
        templates: [
            { name: '双手斧·重劈', prompt: '角色双手持战斧高举过头顶，身体大幅后仰如拉满的弓，然后全身爆发式地将斧头斜向下劈砍，落点有粉碎性的打击感。' },
            { name: '单手刀·斜切', prompt: '角色单手反握或正握短刀从肩部高度向外斜下方快速切砍，利用手腕的灵活性形成快速的切割弧线，动作紧凑迅捷。' }
        ]
    },
    {
        key: 'attack_swing',
        category: 'combat_single',
        displayName: '挥',
        emoji: '💫',
        isEssential: true,
        sortOrder: 10,
        defaultDuration: 1.8,
        intensity: 'strong',
        defaultPrompt: '角色执行一次水平或斜向的大范围挥击：①预备-将武器侧引到身体一侧后方极限位置，上半身反向扭转蓄积旋转势能；②挥出-以脊柱为轴心身体猛然回旋，带动持械手臂沿水平面划出大角度圆弧（120-180度），非持械手臂反向摆动平衡；③挥过中段-武器经过正前方时速度达到最快，身体充分展开；④惯性延续-手臂继续挥动到另一侧极限位置，身体跟随转到新方位；⑤回正-从终点位置收回武器恢复基本站姿。',
        templates: [
            { name: '水平大回环', prompt: null },
            { name: '上撩挥击', prompt: '角色将武器从下方向斜上方快速撩起挥击，从胯下或膝盖高度开始向上划弧直到过头顶，常用于攻击从下往上的目标。' },
            { name: '多圈连续挥', prompt: '角色连续进行2-3圈的快速回旋挥击，像风车一样武器不停地在身边划圆，每一圈逐渐改变角度形成立体的攻击覆盖面。' }
        ]
    },
    {
        key: 'attack_uppercut',
        category: 'combat_single',
        displayName: '挑',
        emoji: '⬆️',
        isEssential: true,
        sortOrder: 11,
        defaultDuration: 1.6,
        intensity: 'strong',
        defaultPrompt: '角色执行一次从下向上的挑击：①下潜预备-身体显著降低重心，屈膝下蹲，将武器放低到膝盖以下或接近地面高度的位置；②向上爆发-腿部猛力蹬直推动身体上升，同时手臂沿斜上方快速抬起武器向上挑击，腰部伸展参与发力；③最高点-手臂向上完全伸展，武器到达轨迹最高点，身体随之上提踮脚；④下落收回-自然放松让手臂回落，身体重心下降回到正常站姿。',
        templates: [
            { name: '正面上勾式', prompt: null },
            { name: '转身回马挑', prompt: '角色先假装向前走或做假动作诱敌靠近，然后突然转身180度同时将武器从下向上挑出攻击身后追来的目标。' },
            { name: '跪姿低挑', prompt: '角色从单膝跪地的低位开始，将武器贴近地面隐藏，然后突然起身的同时将武器从极低处向上猛力挑击。' }
        ]
    },

    // ========== 连击 (3) ==========
    {
        key: 'combo_2',
        category: 'combo',
        displayName: '连击二',
        emoji: '🔨',
        isEssential: true,
        sortOrder: 12,
        defaultDuration: 2.5,
        intensity: 'strong',
        defaultPrompt: '角色执行两段连续攻击组合：第一击执行一次中等力度的攻击，从右向左挥出，命中后手臂不收到底而是停留在左侧前方过渡位置；第二击不停顿地从当前姿势顺势反向从左向右回扫更强力的一击，利用第一击的回弹惯性启动第二击，身体旋转角度更大。两击之间衔接紧密无明显停顿，节奏为嗖-嗖两声快速连贯的攻击感。',
        templates: [
            { name: '横扫+横扫', prompt: null },
            { name: '劈砍+横扫', prompt: '第一击是垂直下劈攻击，第二击接一个横向回旋扫击，一纵一横两个不同方向的组合让敌人难以防御。' },
            { name: '刺+挑', prompt: '第一击是快速直刺攻击敌人中路，趁敌人防守中线时第二击立刻变换方向从下往上挑击。' }
        ]
    },
    {
        key: 'combo_3',
        category: 'combo',
        displayName: '连击三',
        emoji: '🔨',
        isEssential: true,
        sortOrder: 13,
        defaultDuration: 3.2,
        intensity: 'strong',
        defaultPrompt: '角色执行三段递进式连击组合：第一击轻快的起手攻击，速度快但力度一般，主要目的是逼迫对方防守或试探；第二击第一击收回途中立即衔接第二次攻击，力度和范围都比第一击明显提升，节奏开始加快；第三击在第二击的最大惯性点上毫不减速地追加第三击最强力的终结攻击，这一击有明显的力量峰值和收尾感。三击节奏呈现哒-哒-咚的加速递进感。',
        templates: [
            { name: '刺-扫-劈', prompt: null },
            { name: '三连斩', prompt: '三击全部使用斩击动作但每次方向不同：第一击右上向左下斜劈，第二击左下向右上反挑，第三击正前方水平横扫。' },
            { name: '狂乱快打', prompt: '三击都是超高速的小范围快速攻击，牺牲单发威力换取极致的速度，三击总时长压缩到2秒以内。' }
        ]
    },
    {
        key: 'combo_4',
        category: 'combo',
        displayName: '连击四',
        emoji: '🔨',
        isEssential: false,
        sortOrder: 14,
        defaultDuration: 4.0,
        intensity: 'extreme',
        defaultPrompt: '角色执行四段豪华连击组合，具有完整的起承转合结构：第一击中等起手攻击建立节奏；第二击加速衔接开始施压；第三击改变攻击方向打乱对方防御节奏；第四击全力释放的最强终极一击作为完美收尾。四击之间的衔接极其流畅，每一击的结束姿势就是下一击的最佳起始姿势。第四击结束后角色可以有短暂的收招硬直。整体节奏感如同完整的舞蹈编排。',
        templates: [
            { name: '四段华丽连招', prompt: null },
            { name: '剑舞型四连击', prompt: '四击围绕身体进行全方位的回旋攻击，武器像画花朵一样依次在前-左-右-上的四个方向各划出一道致命弧线。' },
            { name: '重型碾压四连', prompt: '四击全是重型攻击，每一击都有明显的蓄力和沉重的打击感，虽然速度不快但压迫感极强，像重型机械一样不可阻挡。' }
        ]
    },

    // ========== 武器 & 状态 (4) ==========
    {
        key: 'draw_weapon',
        category: 'weapon_state',
        displayName: '拔剑',
        emoji: '🗡️',
        isEssential: true,
        sortOrder: 15,
        defaultDuration: 1.5,
        intensity: 'weak',
        defaultPrompt: '角色执行拔出武器的动作：①预备-非持械手先移动到武器鞘或柄的位置按住固定鞘身；②握柄-持械手向后或向下移动到武器柄处，手指握紧武器握把；③拔出-右手稳稳地向斜上方抽出武器，左手配合稍微松开鞘口让武器顺畅滑出；④举起-武器完全离开鞘后，右手将其自然地带到身前的基本持械姿势；⑤就位-调整握姿进入战斗准备姿态。',
        templates: [
            { name: '背后拔剑', prompt: null },
            { name: '腰间拔刀', prompt: '武器挂在右侧腰间，右手直接向后下方伸手握住刀柄快速向前方拔出，动作更快捷直接。' },
            { name: '帅气甩剑', prompt: '拔出武器后在手中快速旋转一圈或做一个花哨的手腕动作再进入持械姿势，带有炫耀或示威意味。' }
        ]
    },
    {
        key: 'sheath_weapon',
        category: 'weapon_state',
        displayName: '收剑',
        emoji: '🗡️',
        isEssential: true,
        sortOrder: 16,
        defaultDuration: 1.5,
        intensity: 'weak',
        defaultPrompt: '角色执行将武器收回鞘中的动作：①降低警惕-将武器从战斗位置缓缓放下，身体姿态从戒备转为放松但仍保持对武器的控制；②归位-非持械手移动到鞘或挂载位置准备接应，持械手将武器带回到鞘口附近对准入口；③插入-稳稳地将武器推入鞘中，动作干脆利落避免磕碰；④确认-手在柄上停留片刻确保武器已安全归鞘；⑤放手-两手离开武器恢复到自然下垂的待机姿势。',
        templates: [
            { name: '标准收刀', prompt: null },
            { name: '快速纳刀', prompt: '战斗结束后快速将武器收入鞘中以便立即转入下一个动作，收剑过程紧凑高效不做多余动作。' },
            { name: '帅气甩入', prompt: '在武器即将入鞘的最后一刻用手腕轻轻一抖或翻转让武器在空中转半圈后精准地落入鞘中。' }
        ]
    },
    {
        key: 'hurt',
        category: 'weapon_state',
        displayName: '受击',
        emoji: '😵',
        isEssential: true,
        sortOrder: 17,
        defaultDuration: 0.8,
        intensity: 'medium',
        defaultPrompt: '角色受到攻击时的受击反馈动画：①被击中瞬间-身体受到来自前方的冲击力，对应部位明显向内凹陷，头部猛地向后仰，双眼可能短暂闭合；②后退失衡-冲击力推动整个身体向后踉跄退步约1-2步，上半身向后倾斜失去平衡，双臂本能地向两侧张开试图维持平衡；③恢复站稳-后退的脚步逐渐稳住，身体从后仰状态慢慢回正，双臂放下；④残余痛感-最后微微弯腰一只手捂住受伤部位，然后慢慢抬头恢复警戒姿态。',
        templates: [
            { name: '轻度受击', prompt: null },
            { name: '重度击退', prompt: '角色被重击打得向后飞出滑行一段距离才停下，双脚在地上拖行摩擦，落地后可能单膝或双手撑地才能勉强站起来。' },
            { name: '击倒倒地', prompt: '角色被击中后直接失去平衡向后倒地，经历臀部着地后坐、背部着地、四肢散开的真实摔倒过程，然后在地上躺1-2秒后才挣扎着爬起来。' }
        ]
    },
    {
        key: 'death',
        category: 'weapon_state',
        displayName: '死亡',
        emoji: '💀',
        isEssential: true,
        sortOrder: 18,
        defaultDuration: 3.0,
        intensity: 'medium',
        defaultPrompt: '角色的死亡倒地动画：①濒死站立-受到致命伤后身体摇晃站立不稳，膝盖发软，武器从手中滑落，眼神涣散；②开始倒下-膝盖终于承受不住首先跪地，上半身开始向前或向一侧倾倒，双手可能无力地向前伸出或捂住伤口；③倒地过程-躯干继续倒下，先是一侧臀部接触地面，然后背部缓缓躺在地上，头颅最后轻轻着地；④彻底死亡-完全躺在地上一动不动，四肢摊开或微微蜷缩。',
        templates: [
            { name: '跪地伏尸', prompt: null },
            { name: '仰面倒地', prompt: '角色向后仰面倒下，背部着地后四肢朝天摊开，面朝天空，像一具尸体般静止。' },
            { name: '英雄式倒下', prompt: '角色单膝跪地坚持了片刻后，像一座雕塑崩塌一样向前扑倒在地，一手仍试图撑住身体但最终失败。' }
        ]
    }
];

// ===== 辅助函数 =====

/**
 * 获取分类下的所有动作
 */
function getMotionsByCategory(category) {
    return MOTION_PRESETS.filter(m => m.category === category);
}

/**
 * 获取分类的显示顺序
 */
function getCategoryOrder() {
    return ['locomotion', 'turning', 'combat_single', 'combo', 'weapon_state'];
}

/**
 * 获取动作预设
 */
function getMotionPreset(key) {
    return MOTION_PRESETS.find(m => m.key === key);
}

/**
 * 获取有效的提示词（null时返回默认提示词）
 */
function getEffectivePrompt(preset, templateIndex) {
    if (templateIndex === null || templateIndex === undefined) {
        return preset.defaultPrompt;
    }
    const template = preset.templates[templateIndex];
    return template && template.prompt ? template.prompt : preset.defaultPrompt;
}

/**
 * 计算动作数量统计
 */
function getMotionStats() {
    const total = MOTION_PRESETS.length;
    const essential = MOTION_PRESETS.filter(m => m.isEssential).length;
    const optional = total - essential;
    
    // 按分类统计
    const byCategory = {};
    for (const key of Object.keys(MOTION_CATEGORIES)) {
        byCategory[key] = getMotionsByCategory(key).length;
    }
    
    return { total, essential, optional, byCategory };
}

/**
 * 估算生成费用（按动作数量和平均单次费用）
 */
function estimateCost(enabledCount, avgCostPerMotion = 1.5) {
    const min = (enabledCount * avgCostPerMotion * 0.6).toFixed(2);
    const max = (enabledCount * avgCostPerMotion * 1.4).toFixed(2);
    return { min, max, display: '¥' + min + ' ~ ¥' + max };
}

/**
 * 估算生成时长（按每个动作平均5秒计算，包括上传和等待）
 */
function estimateDuration(enabledCount, avgTimePerMotion = 8) {
    const seconds = enabledCount * avgTimePerMotion;
    if (seconds < 60) {
        return seconds + '秒';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes + '分' + remainingSeconds + '秒';
}

// 导出给全局使用
window.MOTION_PRESETS = MOTION_PRESETS;
window.MOTION_CATEGORIES = MOTION_CATEGORIES;
window.getMotionsByCategory = getMotionsByCategory;
window.getCategoryOrder = getCategoryOrder;
window.getMotionPreset = getMotionPreset;
window.getEffectivePrompt = getEffectivePrompt;
window.getMotionStats = getMotionStats;
window.estimateCost = estimateCost;
window.estimateDuration = estimateDuration;
