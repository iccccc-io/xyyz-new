// pages/message/list.js
// 消息列表页 - 会话列表

const app = getApp()
const db = wx.cloud.database()
const _ = db.command

Page({
  /**
   * 页面的初始数据
   */
  data: {
    conversations: [],
    loading: true,
    watcher: null
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadConversations()
  },

  /**
   * 加载会话列表
   */
  async loadConversations() {
    const currentOpenid = app.globalData.openid

    if (!currentOpenid) {
      this.setData({ loading: false })
      return
    }

    this.setData({ loading: true })

    try {
      // 查询包含当前用户的所有会话
      const res = await db.collection('chat_rooms')
        .where({
          user_ids: currentOpenid
        })
        .orderBy('update_time', 'desc')
        .limit(50)
        .get()

      const rooms = res.data || []

      // 处理会话数据
      const conversations = rooms.map(room => {
        // 找到对方用户信息
        const targetUserInfo = room.user_info.find(u => u.uid !== currentOpenid) || {}
        
        // 获取未读数
        const unreadCount = room.unread_counts ? (room.unread_counts[currentOpenid] || 0) : 0
        
        // 格式化最后消息时间
        const lastMsgTime = room.last_msg?.time
        const lastMsgTimeStr = this.formatTime(lastMsgTime)
        
        // 最后消息预览
        let lastMsgPreview = ''
        if (room.last_msg) {
          if (room.last_msg.msg_type === 'image') {
            lastMsgPreview = '[图片]'
          } else {
            lastMsgPreview = room.last_msg.content || ''
          }
          // 如果是自己发的
          if (room.last_msg.sender_id === currentOpenid) {
            lastMsgPreview = '我: ' + lastMsgPreview
          }
        }

        return {
          _id: room._id,
          targetUser: {
            uid: targetUserInfo.uid,
            nickname: targetUserInfo.nickname || '用户',
            avatar: targetUserInfo.avatar || '/images/avatar.png'
          },
          unreadCount,
          lastMsgTime,
          lastMsgTimeStr,
          lastMsgPreview: lastMsgPreview.length > 30 
            ? lastMsgPreview.substring(0, 30) + '...' 
            : lastMsgPreview
        }
      })

      this.setData({
        conversations,
        loading: false
      })

      // 开启实时监听
      this.startWatcher()

    } catch (err) {
      console.error('加载会话列表失败:', err)
      this.setData({ loading: false })
    }
  },

  /**
   * 开启实时监听（监听未读数变化）
   */
  startWatcher() {
    const currentOpenid = app.globalData.openid
    if (!currentOpenid) return

    // 关闭旧的监听器
    if (this.data.watcher) {
      this.data.watcher.close()
    }

    // 监听会话变化
    const watcher = db.collection('chat_rooms')
      .where({
        user_ids: currentOpenid
      })
      .watch({
        onChange: (snapshot) => {
          if (snapshot.type === 'init') return
          
          // 有变化时重新加载
          this.loadConversations()
        },
        onError: (err) => {
          console.error('会话监听错误:', err)
        }
      })

    this.setData({ watcher })
  },

  /**
   * 格式化时间
   */
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
    } else if (msgDate.getTime() === yesterday.getTime()) {
      return '昨天'
    } else if (now.getFullYear() === date.getFullYear()) {
      return `${date.getMonth() + 1}/${date.getDate()}`
    } else {
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
    }
  },

  /**
   * 跳转到聊天页
   */
  goToChat(e) {
    const room = e.currentTarget.dataset.room
    const targetUserId = room.targetUser.uid

    wx.navigateTo({
      url: `/pages/chat/room?targetUserId=${targetUserId}`
    })
  },

  /**
   * 跳转到社区
   */
  goToCommunity() {
    wx.switchTab({
      url: '/pages/community/index'
    })
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 更新自定义 tabBar 选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(3)
    }
    
    // 每次显示时刷新列表
    if (!this.data.loading) {
      this.loadConversations()
    }

    // 更新 tabbar 角标
    this.updateTabBarBadge()
  },

  /**
   * 更新 tabbar 角标（使用自定义 tabBar）
   */
  async updateTabBarBadge() {
    const currentOpenid = app.globalData.openid
    if (!currentOpenid) return

    try {
      // 计算总未读数
      const totalUnread = this.data.conversations.reduce((sum, conv) => {
        return sum + (conv.unreadCount || 0)
      }, 0)

      // 更新自定义 tabBar 的未读数
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().updateUnreadCount(totalUnread)
      }
    } catch (err) {
      console.warn('更新角标失败:', err)
    }
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    // 关闭监听器
    if (this.data.watcher) {
      this.data.watcher.close()
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.loadConversations().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '湘韵遗珍 - 发现湖南非遗之美',
      path: '/pages/home/home'
    }
  }
})

