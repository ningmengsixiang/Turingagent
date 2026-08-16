import { describe, expect, it } from 'vitest'
import { classifySilence } from './silence.js'

describe('classifySilence', () => {
  it('responds to @ mentions routed as decision point', () => {
    expect(classifySilence('@Ta-PM 帮我整理下需求').decision).toBe('respond')
  })

  it('responds to decision points (你定/选A还是B/对比一下/审批)', () => {
    expect(classifySilence('这个方案你定吧').decision).toBe('respond')
    expect(classifySilence('选 A 还是 B 好').decision).toBe('respond')
    expect(classifySilence('方案一和方案二对比一下').decision).toBe('respond')
    expect(classifySilence('这个需求需要审批').decision).toBe('respond')
    expect(classifySilence('上线时间你怎么看').decision).toBe('respond')
    expect(classifySilence('这个 bug 怎么办').decision).toBe('respond')
    expect(classifySilence('@Ta-QA 测试下').decision).toBe('respond')
  })

  it('does not fire on emails, code fragments or approval-ack phrases', () => {
    expect(classifySilence('联系 admin@example.com 谢谢').decision).toBe('silent')
    expect(classifySilence('docker pull nginx@sha256:abc123').decision).toBe('silent')
    expect(classifySilence('git checkout feature@dev').decision).toBe('silent')
    expect(classifySilence('我同意').decision).toBe('silent')
    expect(classifySilence('我通过了考试').decision).toBe('silent')
    expect(classifySilence('打卡通过了').decision).toBe('silent')
    expect(classifySilence('@所有人 记得提交日报').decision).toBe('silent')
  })

  it('responds to project keyword signals (score >= 3)', () => {
    expect(classifySilence('需求文档更新了，准备上线').decision).toBe('respond')
    expect(classifySilence('后端接口联调完成，可以部署了').decision).toBe('respond')
    expect(classifySilence('测试用例写完了，开始验收').decision).toBe('respond')
    expect(classifySilence('这个功能设计有问题，需要重构').decision).toBe('respond')
    expect(classifySilence('prd 更新了，代码审查安排下').decision).toBe('respond')
  })

  it('stays silent on idle chat (keyword score < 3, no decision point)', () => {
    expect(classifySilence('晚上一起吃饭？').decision).toBe('silent')
    expect(classifySilence('哈哈哈哈').decision).toBe('silent')
    expect(classifySilence('在吗').decision).toBe('silent')
    expect(classifySilence('嗯嗯，好的').decision).toBe('silent')
    expect(classifySilence('确认收到').decision).toBe('silent')
    expect(classifySilence('你说得对').decision).toBe('silent')
    expect(classifySilence('我看看方案').decision).toBe('silent')
    expect(classifySilence('这个比较好吃').decision).toBe('silent')
    expect(classifySilence('辛苦啦').decision).toBe('silent')
  })

  it('is case-insensitive for english terms', () => {
    expect(classifySilence('API 文档已更新').decision).toBe('respond')
    expect(classifySilence('Fix the BUG please').decision).toBe('respond')
  })
})
