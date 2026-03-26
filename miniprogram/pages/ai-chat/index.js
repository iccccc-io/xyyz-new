const app = getApp()
const db = wx.cloud.database()

const QUICK_REPLIES = {
  ich_project: ['这门技艺有何特色？', '有哪些代表作品？', '如何传承保护？'],
  ich_inheritor: ['请介绍您的技艺', '您的传承故事', '作品有哪些特点？'],
  ich_news: ['深入解读一下', '相关背景是什么？', '有哪些影响？'],
  community_post: ['这篇帖子提到的非遗是什么？', '有类似的体验推荐吗？', '怎么参与这类活动？'],
  community_feed: ['推荐一项湖南非遗', '有什么周末体验攻略？', '哪些非遗最受欢迎？']
}

const WELCOME = {
  ich_project: name => `你好！我是「${name}」的文化向导\n关于它的历史渊源、工艺特色、传承故事，都可以问我~`,
  ich_inheritor: name => `你好！关于非遗传承人「${name}」，我可以为你讲述技艺人生与匠心故事，尽管问吧！`,
  ich_news: name => `你好！关于这篇资讯，我可以为你提供更深入的解读和相关背景，有什么想了解的？`,
  community_post: name => `你好！关于这篇帖子「${name}」，我可以为你解答其中提到的非遗知识，也能推荐类似的内容哦~`,
  community_feed: () => `你好！我是湘韵遗珍生活助手。想了解哪项非遗，或者寻找周末体验攻略？直接问我吧！`
}

// 引用类型对应的跳转路径和图标
const CITATION_CONFIG = {
  ich_project: { icon: '🏛️', route: '/pages/resource/project-detail?id=' },
  ich_inheritor: { icon: '👤', route: '/pages/resource/inheritor-detail?id=' },
  ich_news: { icon: '📰', route: '/pages/resource/news-detail?id=' },
  community_post: { icon: '📝', route: '/pages/community/detail?id=' }
}

Page({
  data: {
    messages: [],
    inputValue: '',
    loading: false,
    isSending: false,
    sourceScene: '',
    sourceEntityName: '',
    sourceEntityId: '',
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
    // 兼容旧参数名（source_type→source_scene, source_name→source_entity_name, source_id→source_entity_id）
    const sourceScene = options.source_scene || options.source_type || 'community_feed'
    const sourceEntityName = decodeURIComponent(options.source_entity_name || options.source_name || '')
    const sourceEntityId = options.source_entity_id || options.source_id || 'global'

    const sys = wx.getSystemInfoSync()
    const statusBarHeight = sys.statusBarHeight
    const navHeight = statusBarHeight + 44
    const safeAreaBottom = sys.screenHeight - sys.safeArea.bottom

    const quickReplies = QUICK_REPLIES[sourceScene] || QUICK_REPLIES.community_feed
    const welcomeFn = WELCOME[sourceScene] || WELCOME.community_feed
    const welcomeText = welcomeFn(sourceEntityName)

    this.setData({
      sourceScene, sourceEntityName, sourceEntityId,
      statusBarHeight, navHeight, safeAreaBottom,
      quickReplies, welcomeText,
      scrollBottom: 96 + safeAreaBottom
    })

    this._autoQuery = options.auto_query ? decodeURIComponent(options.auto_query) : ''
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

    // V3 规则：openid + scene + entity_id
    const conversationId = `${openid}_${this.data.sourceScene}_${this.data.sourceEntityId}`
    this.setData({ conversationId })
    await this.loadHistory()

    // 若携带 auto_query 参数，则自动发送
    if (this._autoQuery) {
      this.setData({ inputValue: this._autoQuery })
      this._autoQuery = ''
      await this.sendMessage()
    }
  },

  async loadHistory() {
    try {
      const res = await db.collection('ai_chat_history')
        .where({ conversation_id: this.data.conversationId })
        .orderBy('create_time', 'asc')
        .limit(200)
        .get()

      if (res.data && res.data.length > 0) {
        const messages = res.data.map(msg => {
          if (msg.role === 'assistant') {
            return this._buildAiMessage(msg)
          }
          return msg
        })
        this.setData({ messages })
        setTimeout(() => this.scrollToBottom(), 300)
      }
    } catch (err) {
      console.error('加载对话历史失败:', err)
    }
  },

  /**
   * 构建 AI 消息对象：解析引用标记，生成富文本片段
   */
  _buildAiMessage(msg) {
    const content = msg.content || ''
    const citations = Array.isArray(msg.citations) ? msg.citations : []
    const suggestedQuestions = Array.isArray(msg.suggested_questions) ? msg.suggested_questions : []

    // 解析 answer 中的 [n] 标记，拆成 segments 用于 WXML 渲染
    const segments = this._parseAnswerSegments(content, citations)

    return {
      ...msg,
      segments,
      citations,
      suggested_questions: suggestedQuestions
    }
  },

  /**
   * 将含 [1][2] 的文本拆分为渲染片段数组
   * 返回 [{type:'text', text:'...'}, {type:'ref', refId:'1', title:'...', targetType:'...', targetId:'...'}, ...]
   */
  _parseAnswerSegments(text, citations) {
    if (!text) return [{ type: 'text', text: '' }]

    const citationMap = {}
    citations.forEach(c => {
      citationMap[c.ref_id] = c
    })

    const segments = []
    const regex = /\[(\d+)\]/g
    let lastIndex = 0
    let match

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', text: text.slice(lastIndex, match.index) })
      }
      const refId = match[1]
      const citation = citationMap[refId]
      if (citation) {
        segments.push({
          type: 'ref',
          refId,
          title: citation.title || '',
          targetType: citation.type || '',
          targetId: citation.target_id || ''
        })
      } else {
        segments.push({ type: 'text', text: match[0] })
      }
      lastIndex = regex.lastIndex
    }

    if (lastIndex < text.length) {
      segments.push({ type: 'text', text: text.slice(lastIndex) })
    }

    return segments.length > 0 ? segments : [{ type: 'text', text }]
  },

  async sendMessage() {
    const query = this.data.inputValue.trim()
    if (!query || this.data.isSending) return

    this.setData({ isSending: true, inputValue: '', loading: true })

    const userMsg = {
      _id: `user_${Date.now()}`,
      conversation_id: this.data.conversationId,
      role: 'user',
      type: 'text',
      content: query,
      create_time: new Date()
    }

    this.setData({ messages: [...this.data.messages, userMsg] })
    this.scrollToBottom()

    try {
      await db.collection('ai_chat_history').add({
        data: {
          conversation_id: this.data.conversationId,
          role: 'user',
          type: 'text',
          content: query,
          create_time: db.serverDate()
        }
      })
    } catch (e) {
      console.warn('用户消息入库失败:', e)
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'ai_chat_proxy',
        data: {
          action: 'send',
          query,
          conversation_id: this.data.conversationId,
          inputs: {
            source_scene: this.data.sourceScene,
            source_entity_name: this.data.sourceEntityName,
            source_entity_id: this.data.sourceEntityId
          }
        }
      })

      const result = res.result
      if (result && result.success) {
        const rawMsg = {
          _id: `ai_${Date.now()}`,
          role: 'assistant',
          type: 'text',
          content: result.answer || '',
          citations: result.citations || [],
          suggested_questions: result.suggested_questions || [],
          create_time: new Date()
        }
        const aiMsg = this._buildAiMessage(rawMsg)

        this.setData({
          messages: [...this.data.messages, aiMsg],
          loading: false,
          isSending: false
        })
      } else {
        this._appendError(result ? result.message : '网络开小差了，大师正在重新连线，请稍后再试。')
      }
    } catch (err) {
      console.error('AI 对话异常:', err)
      this._appendError('网络开小差了，大师正在重新连线，请稍后再试。')
    }

    this.scrollToBottom()
  },

  _appendError(msg) {
    const errorMsg = {
      _id: `err_${Date.now()}`,
      role: 'assistant',
      type: 'text',
      content: msg || '网络开小差了，大师正在重新连线，请稍后再试。',
      isError: true,
      segments: [{ type: 'text', text: msg || '网络开小差了，大师正在重新连线，请稍后再试。' }],
      citations: [],
      suggested_questions: [],
      create_time: new Date()
    }
    this.setData({
      messages: [...this.data.messages, errorMsg],
      loading: false,
      isSending: false
    })
  },

  onQuickReply(e) {
    const text = e.currentTarget.dataset.text
    this.setData({ inputValue: text })
    this.sendMessage()
  },

  /**
   * 点击追问胶囊：自动填入并发送
   */
  onSuggestedTap(e) {
    const text = e.currentTarget.dataset.text
    if (!text || this.data.isSending) return
    this.setData({ inputValue: text })
    this.sendMessage()
  },

  /**
   * 点击引用标记 [n] 或引用卡片：跳转到对应详情页
   */
  onCitationTap(e) {
    const { type, id } = e.currentTarget.dataset
    const config = CITATION_CONFIG[type]
    if (!config || !id) return
    wx.navigateTo({
      url: config.route + id,
      fail: () => {
        wx.showToast({ title: '页面跳转失败', icon: 'none' })
      }
    })
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
      title: `非遗智答 - ${this.data.sourceEntityName || '湘韵遗珍'}`,
      path: `/pages/ai-chat/index?source_scene=${this.data.sourceScene}&source_entity_name=${encodeURIComponent(this.data.sourceEntityName)}&source_entity_id=${this.data.sourceEntityId}`
    }
  }
})
