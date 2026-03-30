// pages/message/list.js
// 消息列表页 - 会话列表

const app = getApp()
const db = wx.cloud.database()
const _ = db.command

const ROOM_PAGE_SIZE = 20
const ROOM_FETCH_LIMIT = 50

Page({
  data: {
    conversations: [],
    loading: true,
    watcher: null
  },

  onLoad() {
    this.loadConversations()
  },

  async loadConversations() {
    const currentOpenid = app.globalData.openid
    if (!currentOpenid) {
      this.setData({
        conversations: [],
        loading: false
      })
      return
    }

    this.setData({ loading: true })

    try {
      const rooms = await this.fetchRooms(currentOpenid)
      const targetIds = rooms
        .map((room) => this.getTargetUserInfo(room, currentOpenid).uid)
        .filter(Boolean)
      const remarkMap = await this.fetchRemarkMap(currentOpenid, targetIds)

      const conversations = rooms
        .map((room) => this.formatConversation(room, currentOpenid, remarkMap))
        .sort((a, b) => {
          if (a.isTop !== b.isTop) {
            return a.isTop ? -1 : 1
          }
          return (b.sortTime || 0) - (a.sortTime || 0)
        })

      this.setData({
        conversations,
        loading: false
      })

      if (!this.data.watcher) {
        this.startWatcher()
      }

      app.refreshChatUnreadBadge(this).catch(() => {})
    } catch (err) {
      console.error('加载会话列表失败:', err)
      this.setData({ loading: false })
      app.refreshChatUnreadBadge(this).catch(() => {})
    }
  },

  async fetchRooms(currentOpenid) {
    const countRes = await db.collection('chat_rooms')
      .where({
        user_ids: currentOpenid
      })
      .count()

    const total = Math.min(countRes.total || 0, ROOM_FETCH_LIMIT)
    if (!total) return []

    const batches = Math.ceil(total / ROOM_PAGE_SIZE)
    const rooms = []

    for (let index = 0; index < batches; index += 1) {
      const res = await db.collection('chat_rooms')
        .where({
          user_ids: currentOpenid
        })
        .orderBy('update_time', 'desc')
        .skip(index * ROOM_PAGE_SIZE)
        .limit(Math.min(ROOM_PAGE_SIZE, total - index * ROOM_PAGE_SIZE))
        .get()

      rooms.push(...(res.data || []))
    }

    return rooms
  },

  async fetchRemarkMap(currentOpenid, targetIds = []) {
    const uniqueIds = [...new Set(targetIds.filter(Boolean))]
    const remarkMap = {}

    for (let index = 0; index < uniqueIds.length; index += 20) {
      const batchIds = uniqueIds.slice(index, index + 20)
      const res = await db.collection('community_follows')
        .where({
          follower_id: currentOpenid,
          target_id: _.in(batchIds)
        })
        .field({
          target_id: true,
          remark_name: true
        })
        .get()

      ;(res.data || []).forEach((item) => {
        if (item.target_id && item.remark_name) {
          remarkMap[item.target_id] = item.remark_name
        }
      })
    }

    return remarkMap
  },

  getTargetUserInfo(room, currentOpenid) {
    return (room.user_info || []).find((item) => item.uid !== currentOpenid) || {}
  },

  formatConversation(room, currentOpenid, remarkMap = {}) {
    const targetUserInfo = this.getTargetUserInfo(room, currentOpenid)
    const targetUid = targetUserInfo.uid || ''
    const clearTime = Number((room.clear_time && room.clear_time[currentOpenid]) || 0)
    const lastMsgTime = room.last_msg && room.last_msg.time
      ? new Date(room.last_msg.time).getTime()
      : 0
    const lastMsgVisible = lastMsgTime > clearTime

    let lastMsgPreview = '暂无消息'
    let lastMsgTimeStr = ''

    if (room.last_msg && lastMsgVisible) {
      const rawContent = room.last_msg.msg_type === 'image'
        ? '[图片]'
        : (room.last_msg.content || '')
      lastMsgPreview = room.last_msg.sender_id === currentOpenid
        ? `我: ${rawContent}`
        : rawContent
      if (lastMsgPreview.length > 30) {
        lastMsgPreview = `${lastMsgPreview.substring(0, 30)}...`
      }
      lastMsgTimeStr = this.formatTime(lastMsgTime)
    }

    return {
      _id: room._id,
      roomId: room._id,
      isTop: !!(room.is_top && room.is_top[currentOpenid]),
      isMuted: !!(room.is_muted && room.is_muted[currentOpenid]),
      sortTime: room.update_time ? new Date(room.update_time).getTime() : 0,
      unreadCount: Number((room.unread_counts && room.unread_counts[currentOpenid]) || 0),
      clearTime,
      lastMsgTime,
      lastMsgTimeStr,
      lastMsgPreview,
      targetUser: {
        uid: targetUid,
        nickname: targetUserInfo.nickname || '用户',
        displayName: remarkMap[targetUid] || targetUserInfo.nickname || '用户',
        avatar: targetUserInfo.avatar || '/images/avatar.png'
      }
    }
  },

  startWatcher() {
    const currentOpenid = app.globalData.openid
    if (!currentOpenid) return

    if (this.data.watcher) {
      this.data.watcher.close()
    }

    const watcher = db.collection('chat_rooms')
      .where({
        user_ids: currentOpenid
      })
      .watch({
        onChange: (snapshot) => {
          if (snapshot.type === 'init') return
          this.loadConversations()
        },
        onError: (err) => {
          console.error('会话监听错误:', err)
          this.setData({ watcher: null })
        }
      })

    this.setData({ watcher })
  },

  formatTime(time) {
    if (!time) return ''

    const date = new Date(time)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const timeStr = `${hours}:${minutes}`

    if (msgDate.getTime() === today.getTime()) {
      return timeStr
    }
    if (msgDate.getTime() === yesterday.getTime()) {
      return '昨天'
    }
    if (now.getFullYear() === date.getFullYear()) {
      return `${date.getMonth() + 1}/${date.getDate()}`
    }
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  },

  goToChat(e) {
    const room = e.currentTarget.dataset.room
    const targetUserId = room && room.targetUser ? room.targetUser.uid : ''
    if (!targetUserId) return

    wx.navigateTo({
      url: `/pages/chat/room?targetUserId=${targetUserId}&room_id=${room.roomId || room._id}`
    })
  },

  goToCommunity() {
    wx.switchTab({
      url: '/pages/community/index'
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(3)
    }

    if (!this.data.loading) {
      this.loadConversations()
    }

    app.refreshChatUnreadBadge(this).catch(() => {})
  },

  onUnload() {
    if (this.data.watcher) {
      this.data.watcher.close()
    }
  },

  onPullDownRefresh() {
    this.loadConversations().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onShareAppMessage() {
    return {
      title: '湘韵遗珍 - 发现湖南非遗之美',
      path: '/pages/home/home'
    }
  }
})
