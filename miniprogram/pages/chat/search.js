const db = wx.cloud.database()
const _ = db.command

function escapeRegExp(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const time = `${hours}:${minutes}`

  if (msgDay.getTime() === today.getTime()) return `今天 ${time}`
  if (msgDay.getTime() === today.getTime() - 86400000) return `昨天 ${time}`
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

Page({
  data: {
    roomId: '',
    targetUserId: '',
    displayName: '聊天记录',
    clearTime: 0,
    keyword: '',
    loading: false,
    searched: false,
    results: []
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

  async loadMeta() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_chat_session',
        data: {
          action: 'get_meta',
          room_id: this.data.roomId,
          target_user_id: this.data.targetUserId
        }
      })

      if (res.result?.success && res.result?.data) {
        const targetUser = res.result.data.target_user || {}
        const room = res.result.data.room || {}
        this.setData({
          displayName: targetUser.display_name || targetUser.nickname || '聊天记录',
          clearTime: Number(room.clear_time || 0)
        })
      }
    } catch (err) {
      console.warn('加载搜索元数据失败:', err)
    }
  },

  onKeywordInput(e) {
    this.setData({
      keyword: e.detail.value
    })
  },

  clearKeyword() {
    this.setData({
      keyword: '',
      searched: false,
      results: []
    })
  },

  async searchMessages() {
    const keyword = String(this.data.keyword || '').trim()
    if (!keyword) {
      wx.showToast({ title: '请输入关键词', icon: 'none' })
      return
    }

    const conditions = [
      { room_id: this.data.roomId },
      { msg_type: 'text' },
      { is_revoked: false },
      {
        content: db.RegExp({
          regexp: escapeRegExp(keyword),
          options: 'i'
        })
      }
    ]

    if (this.data.clearTime > 0) {
      conditions.push({ send_time: _.gt(new Date(this.data.clearTime)) })
    }

    this.setData({
      loading: true,
      searched: true
    })

    try {
      const res = await db.collection('chat_messages')
        .where(_.and(conditions))
        .orderBy('send_time', 'desc')
        .limit(50)
        .get()

      const results = (res.data || []).map((item) => ({
        ...item,
        timeStr: formatTime(item.send_time)
      }))

      this.setData({
        results,
        loading: false
      })
    } catch (err) {
      console.error('搜索聊天记录失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '搜索失败', icon: 'none' })
    }
  }
})
