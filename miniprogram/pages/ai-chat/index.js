const app = getApp()
const db = wx.cloud.database()

const QUICK_REPLIES = {
  project: ['这门技艺有何特色？', '有哪些代表作品？', '如何传承保护？'],
  inheritor: ['请介绍您的技艺', '您的传承故事', '作品有哪些特点？'],
  news: ['深入解读一下', '相关背景是什么？', '有哪些影响？']
}

const WELCOME = {
  project: name => `你好！我是「${name}」的文化向导\n关于它的历史渊源、工艺特色、传承故事，都可以问我~`,
  inheritor: name => `你好！关于非遗传承人「${name}」，我可以为你讲述技艺人生与匠心故事，尽管问吧！`,
  news: name => `你好！关于这篇资讯，我可以为你提供更深入的解读和相关背景，有什么想了解的？`
}

Page({
  data: {
    messages: [],
    inputValue: '',
    loading: false,
    isSending: false,
    sourceType: '',
    sourceName: '',
    sourceId: '',
    conversationId: '',
    quickReplies: [],
    welcomeText: '',
    statusBarHeight: 0,
    navHeight: 0,
    keyboardHeight: 0,
    safeAreaBottom: 0,
    scrollBottom: 100,
    scrollToView: ''
  },

  onLoad(options) {
    const sourceType = options.source_type || 'project'
    const sourceName = decodeURIComponent(options.source_name || '')
    const sourceId = options.source_id || ''

    const sys = wx.getSystemInfoSync()
    const statusBarHeight = sys.statusBarHeight
    const navHeight = statusBarHeight + 44
    const safeAreaBottom = sys.screenHeight - sys.safeArea.bottom

    const quickReplies = QUICK_REPLIES[sourceType] || QUICK_REPLIES.project
    const welcomeText = (WELCOME[sourceType] || WELCOME.project)(sourceName)

    this.setData({
      sourceType, sourceName, sourceId,
      statusBarHeight, navHeight, safeAreaBottom,
      quickReplies, welcomeText,
      scrollBottom: 96 + safeAreaBottom
    })

    this._initConversation()

    this._onKeyboardHeight = (res) => {
      const kbH = res.height
      this.setData({
        keyboardHeight: kbH,
        scrollBottom: kbH > 0 ? (54 + kbH) : (96 + this.data.safeAreaBottom)
      })
      if (kbH > 0) this.scrollToBottom()
    }
    wx.onKeyboardHeightChange(this._onKeyboardHeight)
  },

  onUnload() {
    if (this._onKeyboardHeight) {
      wx.offKeyboardHeightChange(this._onKeyboardHeight)
    }
  },

  async _initConversation() {
    let openid = app.globalData.openid
    if (!openid) {
      openid = await new Promise(resolve => {
        const check = setInterval(() => {
          if (app.globalData.openid) {
            clearInterval(check)
            resolve(app.globalData.openid)
          }
        }, 100)
        setTimeout(() => { clearInterval(check); resolve(null) }, 5000)
      })
    }

    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    const conversationId = `${openid}_${this.data.sourceId}`
    this.setData({ conversationId })
    this.loadHistory()
  },

  async loadHistory() {
    try {
      const res = await db.collection('ai_chat_history')
        .where({ conversation_id: this.data.conversationId })
        .orderBy('create_time', 'asc')
        .limit(200)
        .get()

      if (res.data && res.data.length > 0) {
        this.setData({ messages: res.data })
        setTimeout(() => this.scrollToBottom(), 300)
      }
    } catch (err) {
      console.error('加载对话历史失败:', err)
    }
  },

  async sendMessage() {
    const query = this.data.inputValue.trim()
    if (!query || this.data.isSending) return

    this.setData({ isSending: true, inputValue: '', loading: true })

    const sourceInfo = {
      type: this.data.sourceType,
      name: this.data.sourceName,
      id: this.data.sourceId
    }

    const userMsg = {
      _id: `user_${Date.now()}`,
      conversation_id: this.data.conversationId,
      role: 'user',
      type: 'text',
      content: query,
      source_info: sourceInfo,
      create_time: new Date()
    }

    this.setData({ messages: [...this.data.messages, userMsg] })
    this.scrollToBottom()

    // 用户消息持久化
    try {
      await db.collection('ai_chat_history').add({
        data: {
          conversation_id: this.data.conversationId,
          role: 'user',
          type: 'text',
          content: query,
          source_info: sourceInfo,
          create_time: db.serverDate()
        }
      })
    } catch (e) {
      console.warn('用户消息入库失败:', e)
    }

    // 调用 AI 云函数
    try {
      const res = await wx.cloud.callFunction({
        name: 'ai_chat_proxy',
        data: {
          action: 'send',
          query,
          conversation_id: this.data.conversationId,
          inputs: {
            source_type: this.data.sourceType,
            source_name: this.data.sourceName,
            source_id: this.data.sourceId
          }
        }
      })

      const result = res.result
      if (result && result.success) {
        const aiMsg = {
          _id: `ai_${Date.now()}`,
          role: 'assistant',
          type: 'text',
          content: result.answer,
          create_time: new Date()
        }
        this.setData({
          messages: [...this.data.messages, aiMsg],
          loading: false,
          isSending: false
        })
      } else {
        this._appendError(result ? result.message : '大师此刻忙碌，请稍后再问')
      }
    } catch (err) {
      console.error('AI 对话异常:', err)
      this._appendError('大师此刻忙碌，请稍后再问')
    }

    this.scrollToBottom()
  },

  _appendError(msg) {
    this.setData({
      messages: [...this.data.messages, {
        _id: `err_${Date.now()}`,
        role: 'assistant',
        type: 'text',
        content: msg || '大师此刻忙碌，请稍后再问',
        isError: true,
        create_time: new Date()
      }],
      loading: false,
      isSending: false
    })
  },

  onQuickReply(e) {
    const text = e.currentTarget.dataset.text
    this.setData({ inputValue: text })
    this.sendMessage()
  },

  onInputChange(e) {
    this.setData({ inputValue: e.detail.value })
  },

  async onClearHistory() {
    const { confirm } = await wx.showModal({
      title: '清除对话',
      content: '确定清除所有对话记录？此操作不可恢复。',
      confirmColor: '#b63b36'
    })
    if (!confirm) return

    wx.showLoading({ title: '清除中...' })
    try {
      await wx.cloud.callFunction({
        name: 'ai_chat_proxy',
        data: { action: 'clear', conversation_id: this.data.conversationId }
      })
      this.setData({ messages: [] })
      wx.showToast({ title: '已清除', icon: 'success' })
    } catch (err) {
      console.error('清除失败:', err)
      wx.showToast({ title: '清除失败', icon: 'none' })
    }
    wx.hideLoading()
  },

  scrollToBottom() {
    this.setData({ scrollToView: '' })
    setTimeout(() => {
      this.setData({ scrollToView: 'scroll-bottom' })
    }, 50)
  },

  onLongPressBubble(e) {
    const content = e.currentTarget.dataset.content
    if (!content) return
    wx.showActionSheet({
      itemList: ['复制文本'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.setClipboardData({ data: content })
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  },

  goToSource() {
    wx.navigateBack()
  },

  onShareAppMessage() {
    return {
      title: `非遗智答 - ${this.data.sourceName}`,
      path: `/pages/ai-chat/index?source_type=${this.data.sourceType}&source_name=${encodeURIComponent(this.data.sourceName)}&source_id=${this.data.sourceId}`
    }
  }
})
