const DEFAULT_AVATAR = '/images/avatar.png'

Page({
  data: {
    loading: true,
    submitting: false,
    roomId: '',
    targetUserId: '',
    targetUser: {
      nickname: '用户',
      display_name: '用户',
      avatar_url: DEFAULT_AVATAR
    },
    relation: {
      is_following: false,
      is_followed_by_target: false,
      is_mutual: false,
      remark_name: '',
      has_blocked_target: false,
      is_blocked_by_target: false
    },
    room: {
      is_top: false,
      is_muted: false,
      clear_time: 0
    },
    relationStatusText: '未关注',
    followButtonText: '关注',
    showRemarkEditor: false,
    remarkDraft: ''
  },

  onLoad(options) {
    const roomId = options.roomId || options.room_id || ''
    const targetUserId = options.targetUserId || options.userId || ''

    if (!roomId || !targetUserId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }

    this.setData({ roomId, targetUserId })
    this.loadMeta()
  },

  noop() {},

  async loadMeta() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_chat_session',
        data: {
          action: 'get_meta',
          room_id: this.data.roomId,
          target_user_id: this.data.targetUserId
        }
      })

      if (!res.result?.success || !res.result?.data) {
        throw new Error(res.result?.message || '加载失败')
      }

      this.applyMeta(res.result.data)
      this.setData({ loading: false })
    } catch (err) {
      console.error('加载聊天管理信息失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  applyMeta(meta = {}) {
    const targetUser = meta.target_user || {}
    const relation = meta.relation || {}
    const room = meta.room || {}
    const relationStatusText = relation.is_mutual
      ? '已互关'
      : relation.is_following
        ? '已关注'
        : relation.is_followed_by_target
          ? '对方已关注你'
          : '未关注'

    this.setData({
      targetUser: {
        ...targetUser,
        display_name: targetUser.display_name || targetUser.nickname || '用户',
        avatar_url: targetUser.avatar_url || DEFAULT_AVATAR
      },
      relation,
      room,
      relationStatusText,
      followButtonText: relation.is_following ? '已关注' : '关注',
      remarkDraft: relation.remark_name || ''
    })
  },

  async runAction(action, payload = {}, successText = '') {
    if (this.data.submitting) return null

    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_chat_session',
        data: {
          action,
          room_id: this.data.roomId,
          target_user_id: this.data.targetUserId,
          ...payload
        }
      })

      if (!res.result?.success || !res.result?.data) {
        throw new Error(res.result?.message || '操作失败')
      }

      this.applyMeta(res.result.data)
      if (successText) {
        wx.showToast({ title: successText, icon: 'success' })
      }
      return res.result.data
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      return null
    } finally {
      this.setData({ submitting: false })
    }
  },

  async toggleFollow() {
    const action = this.data.relation.is_following ? 'unfollow' : 'follow'
    const successText = this.data.relation.is_following ? '已取消关注' : '关注成功'
    await this.runAction(action, {}, successText)
  },

  openRemarkEditor() {
    if (!this.data.relation.is_following) {
      wx.showToast({ title: '关注后才可以设置备注', icon: 'none' })
      return
    }

    this.setData({
      showRemarkEditor: true,
      remarkDraft: this.data.relation.remark_name || ''
    })
  },

  closeRemarkEditor() {
    this.setData({ showRemarkEditor: false })
  },

  onRemarkInput(e) {
    this.setData({
      remarkDraft: e.detail.value
    })
  },

  async submitRemark() {
    const remarkName = String(this.data.remarkDraft || '').trim()
    const result = await this.runAction(
      'set_remark',
      { remark_name: remarkName },
      remarkName ? '备注已保存' : '备注已清除'
    )

    if (result) {
      this.setData({ showRemarkEditor: false })
    }
  },

  goToSearch() {
    wx.navigateTo({
      url: `/pages/chat/search?roomId=${this.data.roomId}&targetUserId=${this.data.targetUserId}`
    })
  },

  async onToggleTop(e) {
    const value = !!e.detail.value
    await this.runAction('set_top', { value }, value ? '已置顶聊天' : '已取消置顶')
  },

  async onToggleMuted(e) {
    const value = !!e.detail.value
    await this.runAction('set_muted', { value }, value ? '已开启免打扰' : '已关闭免打扰')
  },

  async toggleBlacklist() {
    const nextValue = !this.data.relation.has_blocked_target
    const label = nextValue ? '加入黑名单' : '解除黑名单'
    const content = nextValue
      ? '加入黑名单后，对方将无法再给你发送消息。'
      : '解除黑名单后，对方可再次向你发送消息。'

    const modalRes = await wx.showModal({
      title: label,
      content,
      confirmColor: '#d84f45'
    })

    if (!modalRes.confirm) return
    await this.runAction(
      'toggle_blacklist',
      { value: nextValue },
      nextValue ? '已加入黑名单' : '已解除黑名单'
    )
  },

  async reportChat() {
    const modalRes = await wx.showModal({
      title: '举报聊天',
      content: '确认举报该聊天吗？系统会自动附带最近 3 条聊天记录。',
      confirmColor: '#d84f45'
    })

    if (!modalRes.confirm) return

    try {
      const res = await wx.cloud.callFunction({
        name: 'report_content',
        data: {
          target_type: 'chat_room',
          target_id: this.data.roomId,
          room_id: this.data.roomId,
          reason: '骚扰/违规'
        }
      })

      wx.showToast({
        title: res.result?.success ? '举报成功' : (res.result?.message || '举报失败'),
        icon: res.result?.success ? 'success' : 'none'
      })
    } catch (err) {
      wx.showToast({ title: '举报失败', icon: 'none' })
    }
  },

  async clearHistory() {
    const modalRes = await wx.showModal({
      title: '清空聊天记录',
      content: '仅会清空你自己的聊天视图，对方记录不会受影响。',
      confirmColor: '#d84f45'
    })

    if (!modalRes.confirm) return
    await this.runAction('clear_history', {}, '聊天记录已清空')
  }
})
