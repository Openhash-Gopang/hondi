/**
 * @file plugin-registry.js
 * @description 나비 플러그인 레지스트리 — 등록·업데이트·조회·버전 관리
 * @version 1.0.0
 * @author AI City Inc.
 *
 * ⚠️  이 파일이 event-bus.js를 import하는 것은 허용된다.
 *     반대 방향(event-bus → plugin-registry)은 절대 금지.
 */

import { EventBus, EVENTS } from './event-bus.js'
import { PluginValidator } from './plugin-validator.js'

/**
 * semver에서 major 버전 숫자 추출
 * @param {string} version  예: '2.1.0' → 2
 * @returns {number}
 */
function semverMajor(version) {
  return parseInt(version.split('.')[0], 10)
}

class GopangPluginRegistry {

  constructor() {
    /** @type {Map<string, Object>} name → plugin 인스턴스 */
    this._plugins = new Map()

    /** @type {Map<string, string>} name → version (semver) */
    this._versions = new Map()

    /** @type {boolean} */
    this._initialized = false
  }

  /**
   * 레지스트리 초기화
   */
  async init() {
    if (this._initialized) return
    this._initialized = true
    console.log('[Registry] 플러그인 레지스트리 초기화 완료')
  }

  /**
   * 플러그인 등록
   * 자동으로 유효성 검사 → onLoad() 호출 → 이벤트 구독 등록
   *
   * @param {Object} plugin - GopangDomainPlugin 인스턴스
   * @throws {Error} 중복 이름, 유효성 실패 시
   */
  async register(plugin) {
    const name = plugin?.metadata?.name

    // 중복 이름 확인
    if (this._plugins.has(name)) {
      throw new Error(
        `[Registry] 플러그인 "${name}" 이미 등록됨. 업데이트는 update()를 사용하세요.`
      )
    }

    // 유효성 검사
    await PluginValidator.validate(plugin)

    // 저장
    this._plugins.set(name, plugin)
    this._versions.set(name, plugin.metadata.version)

    // 이벤트 구독 등록
    this._registerSubscriptions(plugin)

    // 생명주기 훅 호출
    await plugin.onLoad()

    // 등록 완료 이벤트 발행
    EventBus.emit(EVENTS.PLUGIN_REGISTERED, {
      name,
      version: plugin.metadata.version,
      displayName: plugin.metadata.displayName,
    }, 'registry')

    console.log(`[Registry] ✅ ${plugin.metadata.displayName} v${plugin.metadata.version} 등록 완료`)
  }

  /**
   * 플러그인 업데이트 (기존 버전 대체)
   * major 버전 변경 시 BREAKING_CHANGE 오류 발생
   *
   * @param {Object} newPlugin - 새 버전 플러그인 인스턴스
   * @throws {Error} major 버전 불일치, 미등록 플러그인
   */
  async update(newPlugin) {
    const name = newPlugin?.metadata?.name

    if (!this._plugins.has(name)) {
      throw new Error(
        `[Registry] 플러그인 "${name}" 미등록. 최초 등록은 register()를 사용하세요.`
      )
    }

    const prevVersion = this._versions.get(name)
    const nextVersion = newPlugin.metadata.version

    // major 버전 변경 차단 (breaking change)
    if (semverMajor(prevVersion) !== semverMajor(nextVersion)) {
      throw new Error(
        `[Registry] BREAKING_CHANGE: "${name}" major 버전 변경 불가 (${prevVersion} → ${nextVersion}). 수동 마이그레이션 필요.`
      )
    }

    // 유효성 검사
    await PluginValidator.validate(newPlugin)

    // 기존 플러그인 언로드
    const oldPlugin = this._plugins.get(name)
    this._unregisterSubscriptions(oldPlugin)
    await oldPlugin.onUnload()

    // 새 플러그인 저장
    this._plugins.set(name, newPlugin)
    this._versions.set(name, nextVersion)

    // 이벤트 구독 재등록
    this._registerSubscriptions(newPlugin)

    // 업데이트 훅 호출
    await newPlugin.onUpdate(prevVersion)

    // 업데이트 이벤트 발행
    EventBus.emit(EVENTS.PLUGIN_UPDATED, {
      name,
      from: prevVersion,
      to: nextVersion,
    }, 'registry')

    console.log(`[Registry] 🔄 ${name} 업데이트 완료 (${prevVersion} → ${nextVersion})`)
  }

  /**
   * 플러그인 조회
   * @param {string} name
   * @returns {Object|undefined}
   */
  get(name) {
    return this._plugins.get(name)
  }

  /**
   * 등록된 모든 플러그인 메타데이터 목록
   * @returns {Array<Object>}
   */
  list() {
    return [...this._plugins.values()].map(p => ({
      ...p.metadata,
      version: this._versions.get(p.metadata.name),
    }))
  }

  /**
   * 플러그인 등록 여부 확인
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._plugins.has(name)
  }

  /**
   * 등록된 플러그인 수
   * @returns {number}
   */
  count() {
    return this._plugins.size
  }

  /**
   * 모든 플러그인의 Fast-Path 트리거 통합 목록
   * AI 비서 Phase 1에서 사용
   * @returns {Array}
   */
  getAllFastPathTriggers() {
    const triggers = []
    for (const plugin of this._plugins.values()) {
      try {
        const t = plugin.legalClassifier.getFastPathTriggers()
        triggers.push(...t)
      } catch (_) { /* 개별 플러그인 오류 무시 */ }
    }
    return triggers
  }

  /**
   * 모든 플러그인 초기화 (테스트용)
   */
  clearAll() {
    this._plugins.clear()
    this._versions.clear()
  }

  // ── Private ─────────────────────────────────────────────────────────────

  _registerSubscriptions(plugin) {
    for (const { event, handler } of (plugin.eventSubscriptions ?? [])) {
      EventBus.on(event, handler, plugin.metadata.name)
    }
  }

  _unregisterSubscriptions(plugin) {
    for (const { event, handler } of (plugin.eventSubscriptions ?? [])) {
      EventBus.off(event, handler)
    }
  }
}

// 싱글톤
export const registry = new GopangPluginRegistry()
