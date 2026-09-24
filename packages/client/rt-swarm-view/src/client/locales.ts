/** Swarm view copy: zh is the key-set source of truth; en must match exactly. */

export const NS = 'rtSwarm'

export const zh = {
  'view.swarm': '蜂群',
  'swarm.empty': '暂无工蜂。指挥官派出工蜂后，这里会出现任务卡片。',
  'swarm.emptyHint': '对指挥官下达渗透任务，它会用 subagent_recon / subagent_enum / subagent_exploit 派蜂。',
  'swarm.count': '{count} 只工蜂',
  'swarm.running': '{count} 只执行中',
  'swarm.statusRunning': '执行中',
  'swarm.statusStopped': '已停止（发消息可恢复）',
  'swarm.statusDone': '已完成',
  'swarm.statusPending': '待执行',
  'swarm.duration': '活跃 {duration}',
  'swarm.openTranscript': '查看转录',
  'swarm.modeContinuable': '持续会话',
  'swarm.modeOneShot': '一次性',
  'swarm.loadFailed': '蜂群目录加载失败',
  'swarm.refresh': '刷新',
  'swarm.filterAll': '全部',
  'swarm.filterRunning': '执行中',
  'swarm.filterStopped': '已停',
  'swarm.kindRecon': '侦察',
  'swarm.kindJsint': 'JS分析',
  'swarm.kindWeb': 'Web打点',
  'swarm.kindPivot': '内网横向',
  'swarm.kindOther': '工蜂',
} as const

export type SwarmKey = keyof typeof zh

export const en: Record<SwarmKey, string> = {
  'view.swarm': 'Swarm',
  'swarm.empty': 'No bees yet. Task cards appear here once the commander dispatches workers.',
  'swarm.emptyHint': 'Give the commander a pentest task; it dispatches bees via subagent_recon / subagent_enum / subagent_exploit.',
  'swarm.count': '{count} bees',
  'swarm.running': '{count} running',
  'swarm.statusRunning': 'Running',
  'swarm.statusStopped': 'Stopped (resume by messaging)',
  'swarm.statusDone': 'Done',
  'swarm.statusPending': 'Pending',
  'swarm.duration': 'active {duration}',
  'swarm.openTranscript': 'Open transcript',
  'swarm.modeContinuable': 'Continuable',
  'swarm.modeOneShot': 'One-shot',
  'swarm.loadFailed': 'Swarm catalog failed to load',
  'swarm.refresh': 'Refresh',
  'swarm.filterAll': 'All',
  'swarm.filterRunning': 'Running',
  'swarm.filterStopped': 'Stopped',
  'swarm.kindRecon': 'Recon',
  'swarm.kindJsint': 'JS Intel',
  'swarm.kindWeb': 'Web Exploit',
  'swarm.kindPivot': 'Lateral',
  'swarm.kindOther': 'Bee',
}
