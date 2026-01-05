// pages/chat/room.js
const db = wx.cloud.database()
const _ = db.command

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 房间和用户信息
    roomId: '',
    targetUserId: '',
    targetUser: {
      nickname: '',
      avatar: ''
    },
    currentUser: {
      openid: '',
      nickname: '',
      avatar: ''
    },

    // 消息列表
    messages: [],
    loading: true,
    loadingMore: false,
    noMore: false,

    // 输入相关
    inputValue: '',
    keyboardHeight: 0,
    safeAreaBottom: 0,

    // 滚动相关
    scrollToView: '',

    // 分页
    pageSize: 20,
    oldestMsgTime: null,

    // 实时监听器
    watcher: null
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    console.log('Chat room onLoad:', options)
    
    // 获取目标用户ID（从帖子详情页跳转过来）
    const targetUserId = options.targetUserId || options.userId
    if (!targetUserId) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    // 获取安全区域
    const systemInfo = wx.getSystemInfoSync()
    const safeAreaBottom = systemInfo.safeArea 
      ? systemInfo.screenHeight - systemInfo.safeArea.bottom 
      : 0

    this.setData({
      targetUserId,
      safeAreaBottom
    })

    // 初始化
    this.initChatRoom()
  },

  /**
   * 初始化聊天室
   */
  async initChatRoom() {
    try {
      // 1. 获取当前用户信息
      await this.getCurrentUserInfo()
      
      // 2. 获取目标用户信息
      await this.getTargetUserInfo()
      
      // 3. 生成或获取房间ID
      this.generateRoomId()
      
      // 4. 加载历史消息
      await this.loadMessages(true)
      
      // 5. 开启实时监听
      this.startWatcher()
      
      // 6. 清除未读数
      this.clearUnreadCount()

      this.setData({ loading: false })
      
      // 滚动到底部
      this.scrollToBottom()
    } catch (err) {
      console.error('初始化聊天室失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 获取当前用户信息
   */
  async getCurrentUserInfo() {
    const app = getApp()
    
    // 尝试从全局获取
    if (app.globalData && app.globalData.userInfo) {
      this.setData({
        'currentUser.openid': app.globalData.openid || '',
        'currentUser.nickname': app.globalData.userInfo.nickname || '我',
        'currentUser.avatar': app.globalData.userInfo.avatar_url || '/images/avatar.png'
      })
      return
    }

    // 从云端获取
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'login_get_openid'
      })
      
      if (result && result.openid) {
        // 查询用户信息
        const userRes = await db.collection('users')
          .where({ _openid: result.openid })
          .limit(1)
          .get()
        
        const userInfo = userRes.data[0] || {}
        
        this.setData({
          'currentUser.openid': result.openid,
          'currentUser.nickname': userInfo.nickname || '我',
          'currentUser.avatar': userInfo.avatar_url || '/images/avatar.png'
        })
      }
    } catch (err) {
      console.error('获取当前用户信息失败:', err)
    }
  },

  /**
   * 获取目标用户信息
   */
  async getTargetUserInfo() {
    const { targetUserId } = this.data
    
    try {
      // 先尝试通过 _id 查询
      let userRes = await db.collection('users')
        .doc(targetUserId)
        .get()
        .catch(() => null)
      
      // 如果没找到，尝试通过 _openid 查询
      if (!userRes || !userRes.data) {
        userRes = await db.collection('users')
          .where({ _openid: targetUserId })
          .limit(1)
          .get()
        
        if (userRes.data && userRes.data.length > 0) {
          userRes = { data: userRes.data[0] }
        }
      }

      if (userRes && userRes.data) {
        const user = userRes.data
        this.setData({
          targetUser: {
            _id: user._id,
            openid: user._openid,
            nickname: user.nickname || '用户',
            avatar: user.avatar_url || '/images/avatar.png'
          }
        })
        
        // 更新导航栏标题
        wx.setNavigationBarTitle({
          title: user.nickname || '私信'
        })
      }
    } catch (err) {
      console.error('获取目标用户信息失败:', err)
    }
  },

  /**
   * 生成房间ID（按字母序排列确保唯一性）
   */
  generateRoomId() {
    const { currentUser, targetUser } = this.data
    const uid1 = currentUser.openid
    const uid2 = targetUser.openid || this.data.targetUserId
    
    // 按字母序排列
    const sortedIds = [uid1, uid2].sort()
    const roomId = `${sortedIds[0]}_${sortedIds[1]}`
    
    this.setData({ roomId })
    console.log('Room ID:', roomId)
  },

  /**
   * 加载消息列表
   */
  async loadMessages(isRefresh = false) {
    const { roomId, pageSize, oldestMsgTime, loadingMore, noMore } = this.data
    
    if (!isRefresh && (loadingMore || noMore)) return
    
    if (!isRefresh) {
      this.setData({ loadingMore: true })
    }

    try {
      let query = db.collection('chat_messages')
        .where({ room_id: roomId })
        .orderBy('send_time', 'desc')
        .limit(pageSize)
      
      // 分页查询：加载更早的消息
      if (!isRefresh && oldestMsgTime) {
        query = query.where({
          room_id: roomId,
          send_time: _.lt(oldestMsgTime)
        })
      }

      const res = await query.get()
      const newMessages = res.data.reverse() // 倒序排列

      if (newMessages.length < pageSize) {
        this.setData({ noMore: true })
      }

      // 处理消息数据
      const processedMessages = this.processMessages(newMessages, isRefresh)

      if (isRefresh) {
        this.setData({
          messages: processedMessages,
          oldestMsgTime: processedMessages.length > 0 
            ? processedMessages[0].send_time 
            : null,
          loadingMore: false
        })
      } else {
        // 加载更多：插入到列表前面
        const oldMessages = this.data.messages
        this.setData({
          messages: [...processedMessages, ...oldMessages],
          oldestMsgTime: processedMessages.length > 0 
            ? processedMessages[0].send_time 
            : oldestMsgTime,
          loadingMore: false
        })
      }
    } catch (err) {
      console.error('加载消息失败:', err)
      this.setData({ loadingMore: false })
    }
  },

  /**
   * 处理消息数据（添加时间显示、判断发送者等）
   */
  processMessages(messages, isRefresh = true) {
    const { currentUser } = this.data
    const existingMessages = isRefresh ? [] : this.data.messages
    let lastTime = existingMessages.length > 0 
      ? new Date(existingMessages[existingMessages.length - 1].send_time).getTime()
      : 0

    return messages.map((msg, index) => {
      const msgTime = new Date(msg.send_time).getTime()
      const isSelf = msg.sender_id === currentUser.openid
      
      // 判断是否显示时间（间隔超过5分钟）
      let showTime = false
      let timeStr = ''
      
      if (index === 0 && isRefresh) {
        showTime = true
      } else if (msgTime - lastTime > 5 * 60 * 1000) {
        showTime = true
      }
      
      if (showTime) {
        timeStr = this.formatMessageTime(msg.send_time)
      }
      
      lastTime = msgTime

      return {
        ...msg,
        isSelf,
        showTime,
        timeStr,
        status: msg.status || 'sent'
      }
    })
  },

  /**
   * 格式化消息时间
   */
  formatMessageTime(time) {
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
      return `昨天 ${timeStr}`
    } else if (now.getFullYear() === date.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`
    } else {
      return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`
    }
  },

  /**
   * 开启实时监听
   */
  startWatcher() {
    const { roomId } = this.data
    if (!roomId) return

    // 监听新消息
    this.data.watcher = db.collection('chat_messages')
      .where({ room_id: roomId })
      .orderBy('send_time', 'desc')
      .limit(1)
      .watch({
        onChange: (snapshot) => {
          console.log('Watcher onChange:', snapshot)
          
          if (snapshot.type === 'init') return
          
          // 处理新增消息
          if (snapshot.docChanges) {
            snapshot.docChanges.forEach(change => {
              if (change.queueType === 'enqueue') {
                this.handleNewMessage(change.doc)
              }
            })
          }
        },
        onError: (err) => {
          console.error('Watcher error:', err)
          // 尝试重新连接
          setTimeout(() => {
            this.startWatcher()
          }, 3000)
        }
      })
  },

  /**
   * 处理新消息
   */
  handleNewMessage(newMsg) {
    const { messages, currentUser } = this.data
    
    // 检查消息是否已存在（避免重复）
    const exists = messages.some(m => m._id === newMsg._id)
    if (exists) return

    // 检查是否是自己发的消息（已经乐观更新过）
    const tempIndex = messages.findIndex(m => 
      m._tempId && m.content === newMsg.content && m.sender_id === newMsg.sender_id
    )
    
    if (tempIndex !== -1) {
      // 替换临时消息
      const updatedMessages = [...messages]
      updatedMessages[tempIndex] = {
        ...newMsg,
        isSelf: newMsg.sender_id === currentUser.openid,
        showTime: updatedMessages[tempIndex].showTime,
        timeStr: updatedMessages[tempIndex].timeStr,
        status: 'sent'
      }
      this.setData({ messages: updatedMessages })
    } else {
      // 添加新消息
      const processedMsg = this.processMessages([newMsg], false)[0]
      this.setData({
        messages: [...messages, processedMsg]
      })
    }
    
    // 滚动到底部
    this.scrollToBottom()
    
    // 如果是对方发的消息，清除未读
    if (newMsg.sender_id !== currentUser.openid) {
      this.clearUnreadCount()
    }
  },

  /**
   * 输入事件
   */
  onInput(e) {
    this.setData({
      inputValue: e.detail.value
    })
  },

  /**
   * 输入框聚焦
   */
  onInputFocus(e) {
    const keyboardHeight = e.detail.height || 0
    this.setData({ keyboardHeight })
    
    // 延迟滚动到底部
    setTimeout(() => {
      this.scrollToBottom()
    }, 100)
  },

  /**
   * 输入框失焦
   */
  onInputBlur() {
    this.setData({ keyboardHeight: 0 })
  },

  /**
   * 发送文本消息
   */
  async sendTextMessage() {
    const { inputValue, roomId, currentUser, targetUser, messages } = this.data
    const content = inputValue.trim()
    
    if (!content) return

    // 清空输入框
    this.setData({ inputValue: '' })

    // 生成临时ID
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date()

    // 乐观更新：立即显示发送中状态
    const tempMessage = {
      _id: tempId,
      _tempId: tempId,
      room_id: roomId,
      sender_id: currentUser.openid,
      msg_type: 'text',
      content: content,
      send_time: now.toISOString(),
      isSelf: true,
      showTime: this.shouldShowTime(now),
      timeStr: this.shouldShowTime(now) ? this.formatMessageTime(now) : '',
      status: 'sending'
    }

    this.setData({
      messages: [...messages, tempMessage]
    })
    
    // 滚动到底部
    this.scrollToBottom()

    try {
      // 调用云函数发送消息
      const { result } = await wx.cloud.callFunction({
        name: 'send_chat_msg',
        data: {
          room_id: roomId,
          target_user_id: targetUser.openid || this.data.targetUserId,
          msg_type: 'text',
          content: content,
          user_info: {
            nickname: currentUser.nickname,
            avatar: currentUser.avatar
          },
          target_user_info: {
            nickname: targetUser.nickname,
            avatar: targetUser.avatar
          }
        }
      })

      if (result && result.success) {
        // 更新临时消息状态为已发送
        this.updateMessageStatus(tempId, 'sent', result.msgId)
      } else {
        // 发送失败
        this.updateMessageStatus(tempId, 'failed')
        if (result && result.message) {
          wx.showToast({
            title: result.message,
            icon: 'none'
          })
        }
      }
    } catch (err) {
      console.error('发送消息失败:', err)
      this.updateMessageStatus(tempId, 'failed')
      wx.showToast({
        title: '发送失败',
        icon: 'none'
      })
    }
  },

  /**
   * 选择图片
   */
  async chooseImage() {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })

      if (res.tempFiles && res.tempFiles.length > 0) {
        const tempFile = res.tempFiles[0]
        this.sendImageMessage(tempFile.tempFilePath)
      }
    } catch (err) {
      if (err.errMsg && !err.errMsg.includes('cancel')) {
        console.error('选择图片失败:', err)
      }
    }
  },

  /**
   * 发送图片消息
   */
  async sendImageMessage(tempFilePath) {
    const { roomId, currentUser, targetUser, messages } = this.data
    
    // 生成临时ID
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date()

    // 乐观更新：显示本地图片和上传进度
    const tempMessage = {
      _id: tempId,
      _tempId: tempId,
      room_id: roomId,
      sender_id: currentUser.openid,
      msg_type: 'image',
      content: tempFilePath,
      send_time: now.toISOString(),
      isSelf: true,
      showTime: this.shouldShowTime(now),
      timeStr: this.shouldShowTime(now) ? this.formatMessageTime(now) : '',
      status: 'uploading',
      progress: 0
    }

    this.setData({
      messages: [...messages, tempMessage]
    })
    
    this.scrollToBottom()

    try {
      // 上传图片到云存储
      const cloudPath = `chat/${roomId}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`
      
      const uploadTask = wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath
      })

      // 监听上传进度
      uploadTask.onProgressUpdate((res) => {
        this.updateMessageProgress(tempId, res.progress)
      })

      const uploadRes = await uploadTask
      const fileID = uploadRes.fileID

      // 调用云函数发送消息
      const { result } = await wx.cloud.callFunction({
        name: 'send_chat_msg',
        data: {
          room_id: roomId,
          target_user_id: targetUser.openid || this.data.targetUserId,
          msg_type: 'image',
          content: fileID,
          user_info: {
            nickname: currentUser.nickname,
            avatar: currentUser.avatar
          },
          target_user_info: {
            nickname: targetUser.nickname,
            avatar: targetUser.avatar
          }
        }
      })

      if (result && result.success) {
        // 更新消息：替换为云存储地址
        const updatedMessages = this.data.messages.map(msg => {
          if (msg._tempId === tempId) {
            return {
              ...msg,
              _id: result.msgId || msg._id,
              content: fileID,
              status: 'sent'
            }
          }
          return msg
        })
        this.setData({ messages: updatedMessages })
      } else {
        this.updateMessageStatus(tempId, 'failed')
        wx.showToast({
          title: result?.message || '发送失败',
          icon: 'none'
        })
      }
    } catch (err) {
      console.error('发送图片失败:', err)
      this.updateMessageStatus(tempId, 'failed')
      wx.showToast({
        title: '发送失败',
        icon: 'none'
      })
    }
  },

  /**
   * 更新消息状态
   */
  updateMessageStatus(tempId, status, realId = null) {
    const messages = this.data.messages.map(msg => {
      if (msg._tempId === tempId) {
        return {
          ...msg,
          _id: realId || msg._id,
          status
        }
      }
      return msg
    })
    this.setData({ messages })
  },

  /**
   * 更新上传进度
   */
  updateMessageProgress(tempId, progress) {
    const messages = this.data.messages.map(msg => {
      if (msg._tempId === tempId) {
        return { ...msg, progress }
      }
      return msg
    })
    this.setData({ messages })
  },

  /**
   * 重新发送消息
   */
  resendMessage(e) {
    const msg = e.currentTarget.dataset.msg
    
    wx.showActionSheet({
      itemList: ['重新发送', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 重新发送
          if (msg.msg_type === 'text') {
            this.setData({ inputValue: msg.content })
            this.removeMessage(msg._tempId || msg._id)
          } else if (msg.msg_type === 'image') {
            // 图片需要重新上传
            this.removeMessage(msg._tempId || msg._id)
            this.sendImageMessage(msg.content)
          }
        } else if (res.tapIndex === 1) {
          // 删除
          this.removeMessage(msg._tempId || msg._id)
        }
      }
    })
  },

  /**
   * 删除本地消息
   */
  removeMessage(msgId) {
    const messages = this.data.messages.filter(m => 
      m._id !== msgId && m._tempId !== msgId
    )
    this.setData({ messages })
  },

  /**
   * 判断是否需要显示时间
   */
  shouldShowTime(time) {
    const { messages } = this.data
    if (messages.length === 0) return true
    
    const lastMsg = messages[messages.length - 1]
    const lastTime = new Date(lastMsg.send_time).getTime()
    const currentTime = new Date(time).getTime()
    
    return currentTime - lastTime > 5 * 60 * 1000
  },

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    setTimeout(() => {
      this.setData({
        scrollToView: 'msg-bottom'
      })
    }, 100)
  },

  /**
   * 加载更多历史消息
   */
  loadMoreMessages() {
    if (!this.data.loadingMore && !this.data.noMore) {
      this.loadMessages(false)
    }
  },

  /**
   * 清除未读数
   */
  async clearUnreadCount() {
    const { roomId, currentUser } = this.data
    if (!roomId || !currentUser.openid) return

    try {
      await db.collection('chat_rooms')
        .doc(roomId)
        .update({
          data: {
            [`unread_counts.${currentUser.openid}`]: 0
          }
        })
    } catch (err) {
      // 房间可能不存在，忽略错误
      console.log('清除未读数:', err.message)
    }
  },

  /**
   * 预览图片
   */
  previewImage(e) {
    const src = e.currentTarget.dataset.src
    const images = this.data.messages
      .filter(m => m.msg_type === 'image')
      .map(m => m.content)
    
    wx.previewImage({
      current: src,
      urls: images
    })
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack()
  },

  /**
   * 跳转到用户主页
   */
  goToUserProfile() {
    const { targetUser, targetUserId } = this.data
    const userId = targetUser._id || targetUser.openid || targetUserId
    
    if (userId) {
      wx.navigateTo({
        url: `/pages/gerenzhongxin/gerenzhongxin?userId=${userId}`
      })
    }
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    // 关闭监听器，释放资源
    if (this.data.watcher) {
      this.data.watcher.close()
      console.log('Watcher closed')
    }
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    // 可选：页面隐藏时也清除未读
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: `和 ${this.data.targetUser.nickname || '好友'} 的对话`,
      path: `/pages/chat/room?targetUserId=${this.data.targetUserId}`
    }
  }
})

