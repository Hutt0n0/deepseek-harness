/** Skill view copy: zh is the key-set source of truth; en must match exactly. */

export const NS = 'rtSkillView'

export const zh = {
  'view.skills': '技能',
  'skills.empty': '当前工作区没有可管理的技能。',
  'skills.emptyHint': '把 skill 目录放进项目的 .dsh/skills/ 下即可被发现（保存即热加载）。',
  'skills.count': '{count} 个技能',
  'skills.sourceProject': '项目',
  'skills.sourceUser': '用户',
  'skills.sourceBundled': '捆绑',
  'skills.sourceCustom': '自定义',
  'skills.sourceRuntime': '运行时',
  'skills.enabled': '模型可用',
  'skills.disabled': '已停用',
  'skills.modelBlocked': '静态禁用',
  'skills.switchLabel': '启用该技能',
  'skills.detail': '详情',
  'skills.detailPath': '文件',
  'skills.detailDesc': '描述',
  'skills.detailUserOnly': '用户 /name 手势仍可显式加载（管理意图：挡模型不挡操作员）。',
  'skills.notRedteam': '当前会话不是红队指挥官模式。',
  'skills.notRedteamHint': '切换到红队指挥官模式后，此处管理该模式下可用的技能。',
  'skills.loadFailed': '技能列表加载失败',
  'skills.retry': '重试',
  'skills.settingsFailed': '开关写入失败',
} as const

export type SkillViewKey = keyof typeof zh

export const en: Record<SkillViewKey, string> = {
  'view.skills': 'Skills',
  'skills.empty': 'No manageable skills in this workspace.',
  'skills.emptyHint': 'Drop skill directories under the project .dsh/skills/ to have them discovered (hot reload on save).',
  'skills.count': '{count} skills',
  'skills.sourceProject': 'Project',
  'skills.sourceUser': 'User',
  'skills.sourceBundled': 'Bundled',
  'skills.sourceCustom': 'Custom',
  'skills.sourceRuntime': 'Runtime',
  'skills.enabled': 'Model-available',
  'skills.disabled': 'Disabled',
  'skills.modelBlocked': 'Static off',
  'skills.switchLabel': 'Enable this skill',
  'skills.detail': 'Details',
  'skills.detailPath': 'File',
  'skills.detailDesc': 'Description',
  'skills.detailUserOnly': 'The user /name gesture can still load it explicitly (management intent: hide from the model, not the operator).',
  'skills.notRedteam': 'This session is not in red-team commander mode.',
  'skills.notRedteamHint': 'Switch to the red-team commander preset to manage its skills here.',
  'skills.loadFailed': 'Failed to load skill list',
  'skills.retry': 'Retry',
  'skills.settingsFailed': 'Failed to write the toggle',
}
