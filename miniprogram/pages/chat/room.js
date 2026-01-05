// pages/chat/room.js
const db = wx.cloud.database()
const _ = db.command

// Emoji 分类（可复用）
const EMOJI_CATEGORIES = [
  {
    key: 'face',
    name: '表情',
    icon: '😊',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖']
  },
  {
    key: 'gesture',
    name: '手势',
    icon: '👋',
    emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪']
  },
  {
    key: 'heart',
    name: '爱心',
    icon: '❤️',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💝','💘','💌','💟','💯','💢','💥','💫','💦','💨','💣','💬','💭','💤']
  },
  {
    key: 'animal',
    name: '动物',
    icon: '🐶',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦂','🐢','🐍','🦎','🐙','🦑','🦐','🦀','🐡','🐠','🐟','🐬','🐳','🦈']
  },
  {
    key: 'food',
    name: '食物',
    icon: '🍔',
    emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🥔','🍠','🥐','🍞','🥖','🧀','🥚','🍳','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🥤','🍺','🍻','🥂','🍷','🍸','🍹']
  },
  {
    key: 'nature',
    name: '自然',
    icon: '🌸',
    emojis: ['🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎍','🎋','🍃','🍂','🍁','🍄','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌎','🌍','🌏','💫','⭐','🌟','✨','⚡','☄️','💥','🔥','🌪️','🌈','☀️','⛅','☁️','🌧️','⛈️','❄️','☃️','⛄','💨','💧','💦','☔','🌊']
  },
  {
    key: 'object',
    name: '物品',
    icon: '💡',
    emojis: ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','💽','💾','💿','📀','📷','📹','🎥','📞','☎️','📺','📻','🎙️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','💸','💵','💳','💎','🔧','🔨','🔩','⚙️','🔫','💣','🔪','🛡️','🔮','💈','🔭','🔬','💊','💉','🚽','🚿','🛁','🔑','🚪','🛋️','🛏️','🖼️','🛍️','🎁','🎈','🎏','🎀','🎊','🎉','🎎','🏮','✉️','📦','📜','📄','📰','📚','📖','🔖','🏷️','💰']
  },
  {
    key: 'travel',
    name: '交通',
    icon: '🚗',
    emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🛴','🚲','🛵','🏍️','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','💺','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🚢','⚓']
  },
  {
    key: 'symbol',
    name: '符号',
    icon: '💯',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','💔','❣️','💕','💞','💓','💗','💖','💝','💘','✨','💫','🌟','⭐','✅','❌','❓','❗','💯','🔥','💥','💢','💤','💨','💦','🎵','🎶','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','💠','🔘','🔳','🔲']
  }
]

// Emoji 搜索关键词
const EMOJI_KEYWORDS = {
  '😀': ['笑', '开心', '高兴', 'smile', 'happy', 'grin'],
  '😂': ['笑哭', '大笑', 'laugh', 'cry', 'tears', 'joy'],
  '🥰': ['爱', '喜欢', 'love', 'hearts'],
  '😍': ['爱', '喜欢', '花痴', 'love', 'heart', 'eyes'],
  '😘': ['亲', '飞吻', 'kiss', 'blow'],
  '😭': ['哭', '大哭', '伤心', 'cry', 'sad', 'tears'],
  '😡': ['生气', '愤怒', 'angry', 'mad', 'rage'],
  '😱': ['惊恐', '害怕', 'fear', 'scared', 'shock'],
  '🤔': ['思考', '想', 'think', 'hmm'],
  '👍': ['赞', '好', '棒', 'good', 'like', 'thumb', 'up'],
  '👎': ['踩', '差', 'bad', 'dislike', 'down'],
  '👏': ['鼓掌', '棒', 'clap', 'bravo'],
  '🙏': ['祈祷', '拜托', '谢谢', 'pray', 'thanks', 'please'],
  '💪': ['加油', '强', 'strong', 'muscle', 'power'],
  '❤️': ['爱', '心', '红心', 'love', 'heart', 'red'],
  '💔': ['心碎', '伤心', 'broken', 'heart'],
  '🔥': ['火', '热', '厉害', 'fire', 'hot', 'lit'],
  '✨': ['闪', '星星', 'sparkle', 'star', 'shine'],
  '🎉': ['庆祝', '派对', 'party', 'celebrate', 'tada'],
  '🎂': ['生日', '蛋糕', 'birthday', 'cake'],
  '🎁': ['礼物', 'gift', 'present'],
  '👋': ['挥手', '你好', '再见', 'hi', 'hello', 'wave', 'bye'],
  '🐶': ['狗', '小狗', 'dog', 'puppy'],
  '🐱': ['猫', '小猫', 'cat', 'kitty'],
  '🐼': ['熊猫', 'panda'],
  '🍔': ['汉堡', 'burger', 'hamburger'],
  '🍕': ['披萨', 'pizza'],
  '☕': ['咖啡', 'coffee'],
  '🍺': ['啤酒', 'beer'],
  '🍷': ['红酒', '葡萄酒', 'wine'],
  '✈️': ['飞机', '出行', 'plane', 'flight', 'travel'],
  '🚗': ['汽车', '车', 'car'],
  '📱': ['手机', 'phone', 'mobile'],
  '💻': ['电脑', 'computer', 'laptop'],
  '🎮': ['游戏', 'game'],
  '⚽': ['足球', 'football', 'soccer'],
  '🏀': ['篮球', 'basketball'],
  '🌈': ['彩虹', 'rainbow'],
  '☀️': ['太阳', '晴天', 'sun', 'sunny'],
  '🌙': ['月亮', '晚上', 'moon', 'night'],
  '⭐': ['星星', 'star'],
  '💯': ['满分', '一百', 'hundred', 'perfect'],
  '✅': ['对', '正确', 'check', 'correct', 'yes'],
  '❌': ['错', '不', 'wrong', 'no', 'cross']
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 64,
    safeAreaBottom: 0,
    
    roomId: '',
    targetUserId: '',
    targetUser: {},
    currentUser: {},
    messages: [],
    
    loading: true,
    loadingMore: false,
    noMore: false,
    
    inputValue: '',
    inputFocus: false,
    keyboardHeight: 0,
    bottomHeight: 60,
    
    showEmojiPanel: false,
    emojiCategories: EMOJI_CATEGORIES,
    emojiActiveTab: 0,
    emojiScrollTo: '',
    emojiSearchKey: '',
    emojiSearchResults: [],
    
    scrollToView: '',
    pageSize: 20,
    oldestMsgTime: null,
    watcher: null
  },

  onLoad(options) {
    const targetUserId = options.targetUserId || options.userId
    if (!targetUserId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }

    const sys = wx.getSystemInfoSync()
    const statusBarHeight = sys.statusBarHeight || 20
    const navBarHeight = statusBarHeight + 44
    const safeAreaBottom = sys.screenHeight - sys.safeArea.bottom

    this.setData({
      targetUserId,
      statusBarHeight,
      navBarHeight,
      safeAreaBottom,
      bottomHeight: 60 + safeAreaBottom
    })

    this.initChat()
  },

  async initChat() {
    try {
      await this.getCurrentUser()
      await this.getTargetUser()
      this.createRoomId()
      await this.loadMessages(true)
      this.startWatcher()
      this.clearUnread()
      this.setData({ loading: false })
      this.scrollToBottom()
    } catch (e) {
      console.error('初始化失败:', e)
      this.setData({ loading: false })
    }
  },

  async getCurrentUser() {
    const app = getApp()
    let openid = app.globalData?.openid
    let userInfo = app.globalData?.userInfo || {}

    if (!openid) {
      const res = await wx.cloud.callFunction({ name: 'login_get_openid' })
      openid = res.result?.openid
      if (app.globalData) app.globalData.openid = openid
      
      const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
      userInfo = userRes.data[0] || {}
    }

    this.setData({
      currentUser: {
        openid,
        nickname: userInfo.nickname || '我',
        avatar: userInfo.avatar_url || userInfo.avatar || '/images/avatar.png'
      }
    })
  },

  async getTargetUser() {
    const { targetUserId } = this.data
    let user = null

    try {
      const res = await db.collection('users').doc(targetUserId).get()
      user = res.data
    } catch (e) {}

    if (!user) {
      const res = await db.collection('users').where({ _openid: targetUserId }).limit(1).get()
      user = res.data[0]
    }

    if (user) {
      this.setData({
        targetUser: {
          _id: user._id,
          openid: user._openid,
          nickname: user.nickname || '用户',
          avatar: user.avatar_url || '/images/avatar.png'
        }
      })
    }
  },

  createRoomId() {
    const { currentUser, targetUser, targetUserId } = this.data
    const ids = [currentUser.openid, targetUser.openid || targetUserId].sort()
    this.setData({ roomId: ids.join('_') })
  },

  async loadMessages(refresh = false) {
    const { roomId, pageSize, oldestMsgTime, loadingMore, noMore } = this.data
    if (!refresh && (loadingMore || noMore)) return
    if (!refresh) this.setData({ loadingMore: true })

    try {
      let query = db.collection('chat_messages')
        .where({ room_id: roomId })
        .orderBy('send_time', 'desc')
        .limit(pageSize)

      if (!refresh && oldestMsgTime) {
        query = db.collection('chat_messages')
          .where({ room_id: roomId, send_time: _.lt(oldestMsgTime) })
          .orderBy('send_time', 'desc')
          .limit(pageSize)
      }

      const res = await query.get()
      const msgs = res.data.reverse()
      
      if (msgs.length < pageSize) this.setData({ noMore: true })

      const processed = this.processMsgs(msgs, refresh)

      if (refresh) {
        this.setData({
          messages: processed,
          oldestMsgTime: processed[0]?.send_time || null,
          loadingMore: false
        })
      } else {
        this.setData({
          messages: [...processed, ...this.data.messages],
          oldestMsgTime: processed[0]?.send_time || oldestMsgTime,
          loadingMore: false
        })
      }
    } catch (e) {
      console.error('加载消息失败:', e)
      this.setData({ loadingMore: false })
    }
  },

  processMsgs(msgs, refresh) {
    let lastTime = 0
    if (!refresh && this.data.messages.length) {
      lastTime = new Date(this.data.messages[this.data.messages.length - 1].send_time).getTime()
    }

    return msgs.map((msg, i) => {
      const time = new Date(msg.send_time).getTime()
      const showTime = (i === 0 && refresh) || (time - lastTime > 5 * 60 * 1000)
      lastTime = time
      return {
        ...msg,
        showTime,
        timeStr: showTime ? this.formatTime(msg.send_time) : '',
        status: msg.status || 'sent'
      }
    })
  },

  formatTime(t) {
    const d = new Date(t)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    const time = `${h}:${m}`

    if (msgDay.getTime() === today.getTime()) return time
    if (msgDay.getTime() === today.getTime() - 86400000) return `昨天 ${time}`
    return `${d.getMonth()+1}/${d.getDate()} ${time}`
  },

  startWatcher() {
    const { roomId } = this.data
    if (!roomId) return

    this.data.watcher = db.collection('chat_messages')
      .where({ room_id: roomId })
      .orderBy('send_time', 'desc')
      .limit(1)
      .watch({
        onChange: snap => {
          if (snap.type === 'init') return
          snap.docChanges?.forEach(c => {
            if (c.queueType === 'enqueue') this.onNewMsg(c.doc)
          })
        },
        onError: e => {
          console.error('watcher error:', e)
          setTimeout(() => this.startWatcher(), 3000)
        }
      })
  },

  onNewMsg(msg) {
    const { messages, currentUser } = this.data
    if (messages.some(m => m._id === msg._id)) return

    const tempIdx = messages.findIndex(m => m._tempId && m.content === msg.content && m.sender_id === msg.sender_id)
    if (tempIdx > -1) {
      const updated = [...messages]
      updated[tempIdx] = { ...msg, showTime: updated[tempIdx].showTime, timeStr: updated[tempIdx].timeStr, status: 'sent' }
      this.setData({ messages: updated })
    } else {
      const processed = this.processMsgs([msg], false)[0]
      this.setData({ messages: [...messages, processed] })
    }

    this.scrollToBottom()
    if (msg.sender_id !== currentUser.openid) this.clearUnread()
  },

  // ========== 输入相关 ==========
  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  onInputFocus(e) {
    const h = e.detail.height || 0
    const { safeAreaBottom } = this.data
    this.setData({
      keyboardHeight: h,
      showEmojiPanel: false,
      bottomHeight: 60 + safeAreaBottom + h
    })
    setTimeout(() => this.scrollToBottom(), 100)
  },

  onInputBlur() {
    if (!this.data.showEmojiPanel) {
      this.setData({
        keyboardHeight: 0,
        bottomHeight: 60 + this.data.safeAreaBottom
      })
    }
  },

  toggleEmojiPanel() {
    const { showEmojiPanel, safeAreaBottom } = this.data
    if (showEmojiPanel) {
      this.setData({
        showEmojiPanel: false,
        bottomHeight: 60 + safeAreaBottom
      })
    } else {
      this.setData({
        showEmojiPanel: true,
        keyboardHeight: 0,
        inputFocus: false,
        bottomHeight: 60 + 288 + safeAreaBottom
      })
      setTimeout(() => this.scrollToBottom(), 100)
    }
  },

  switchEmojiTab(e) {
    const idx = e.currentTarget.dataset.idx
    const cat = this.data.emojiCategories[idx]
    this.setData({
      emojiActiveTab: idx,
      emojiScrollTo: `cat-${cat.key}`
    })
  },

  // 表情搜索
  onEmojiSearch(e) {
    const key = (e.detail.value || '').toLowerCase().trim()
    this.setData({ emojiSearchKey: key })
    
    if (!key) {
      this.setData({ emojiSearchResults: [] })
      return
    }

    const results = []
    const allEmojis = EMOJI_CATEGORIES.flatMap(c => c.emojis)
    
    for (const emoji of allEmojis) {
      const keywords = EMOJI_KEYWORDS[emoji] || []
      if (keywords.some(kw => kw.toLowerCase().includes(key))) {
        results.push(emoji)
      }
    }
    
    this.setData({ emojiSearchResults: [...new Set(results)].slice(0, 40) })
  },

  clearEmojiSearch() {
    this.setData({ emojiSearchKey: '', emojiSearchResults: [] })
  },

  insertEmoji(e) {
    const emoji = e.currentTarget.dataset.e
    this.setData({ inputValue: this.data.inputValue + emoji })
  },

  // ========== 发送消息 ==========
  async sendTextMessage() {
    const { inputValue, roomId, currentUser, targetUser, messages, targetUserId } = this.data
    const content = inputValue.trim()
    if (!content) return

    this.setData({ inputValue: '' })

    const tempId = `temp_${Date.now()}`
    const now = new Date()
    const tempMsg = {
      _id: tempId,
      _tempId: tempId,
      room_id: roomId,
      sender_id: currentUser.openid,
      msg_type: 'text',
      content,
      send_time: now.toISOString(),
      showTime: this.shouldShowTime(now),
      timeStr: this.shouldShowTime(now) ? this.formatTime(now) : '',
      status: 'sending'
    }

    this.setData({ messages: [...messages, tempMsg] })
    this.scrollToBottom()

    try {
      const res = await wx.cloud.callFunction({
        name: 'send_chat_msg',
        data: {
          room_id: roomId,
          target_user_id: targetUser.openid || targetUserId,
          msg_type: 'text',
          content,
          user_info: { nickname: currentUser.nickname, avatar: currentUser.avatar },
          target_user_info: { nickname: targetUser.nickname, avatar: targetUser.avatar }
        }
      })

      if (res.result?.success) {
        this.updateMsgStatus(tempId, 'sent', res.result.msgId)
      } else {
        this.updateMsgStatus(tempId, 'failed')
        wx.showToast({ title: res.result?.message || '发送失败', icon: 'none' })
      }
    } catch (e) {
      console.error('发送失败:', e)
      this.updateMsgStatus(tempId, 'failed')
    }
  },

  showAttachMenu() {
    wx.showActionSheet({
      itemList: ['从相册选择', '拍照'],
      success: res => {
        if (res.tapIndex === 0) this.chooseImage('album')
        else this.chooseImage('camera')
      }
    })
  },

  async chooseImage(source) {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: [source],
        sizeType: ['compressed']
      })
      if (res.tempFiles?.[0]) {
        this.sendImage(res.tempFiles[0].tempFilePath)
      }
    } catch (e) {}
  },

  async sendImage(path) {
    const { roomId, currentUser, targetUser, messages, targetUserId } = this.data
    const tempId = `temp_${Date.now()}`
    const now = new Date()

    const tempMsg = {
      _id: tempId,
      _tempId: tempId,
      room_id: roomId,
      sender_id: currentUser.openid,
      msg_type: 'image',
      content: path,
      send_time: now.toISOString(),
      showTime: this.shouldShowTime(now),
      timeStr: this.shouldShowTime(now) ? this.formatTime(now) : '',
      status: 'uploading'
    }

    this.setData({ messages: [...messages, tempMsg] })
    this.scrollToBottom()

    try {
      const cloudPath = `chat/${roomId}/${Date.now()}.jpg`
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: path })
      const fileID = uploadRes.fileID

      const res = await wx.cloud.callFunction({
        name: 'send_chat_msg',
        data: {
          room_id: roomId,
          target_user_id: targetUser.openid || targetUserId,
          msg_type: 'image',
          content: fileID,
          user_info: { nickname: currentUser.nickname, avatar: currentUser.avatar },
          target_user_info: { nickname: targetUser.nickname, avatar: targetUser.avatar }
        }
      })

      if (res.result?.success) {
        const msgs = this.data.messages.map(m => {
          if (m._tempId === tempId) return { ...m, _id: res.result.msgId || m._id, content: fileID, status: 'sent' }
          return m
        })
        this.setData({ messages: msgs })
      } else {
        this.updateMsgStatus(tempId, 'failed')
      }
    } catch (e) {
      console.error('图片发送失败:', e)
      this.updateMsgStatus(tempId, 'failed')
    }
  },

  updateMsgStatus(tempId, status, realId) {
    const msgs = this.data.messages.map(m => {
      if (m._tempId === tempId) return { ...m, _id: realId || m._id, status }
      return m
    })
    this.setData({ messages: msgs })
  },

  resendMessage(e) {
    const msg = e.currentTarget.dataset.msg
    wx.showActionSheet({
      itemList: ['重新发送', '删除'],
      success: res => {
        if (res.tapIndex === 0) {
          this.removeMsg(msg._tempId || msg._id)
          if (msg.msg_type === 'text') {
            this.setData({ inputValue: msg.content })
          } else {
            this.sendImage(msg.content)
          }
        } else {
          this.removeMsg(msg._tempId || msg._id)
        }
      }
    })
  },

  removeMsg(id) {
    this.setData({
      messages: this.data.messages.filter(m => m._id !== id && m._tempId !== id)
    })
  },

  shouldShowTime(t) {
    const { messages } = this.data
    if (!messages.length) return true
    const last = new Date(messages[messages.length - 1].send_time).getTime()
    return new Date(t).getTime() - last > 5 * 60 * 1000
  },

  scrollToBottom() {
    setTimeout(() => this.setData({ scrollToView: 'msg-bottom' }), 50)
  },

  loadMoreMessages() {
    if (!this.data.loadingMore && !this.data.noMore) {
      this.loadMessages(false)
    }
  },

  async clearUnread() {
    const { roomId, currentUser } = this.data
    if (!roomId || !currentUser.openid) return
    try {
      await db.collection('chat_rooms').doc(roomId).update({
        data: { [`unread_counts.${currentUser.openid}`]: 0 }
      })
    } catch (e) {}
  },

  previewImage(e) {
    const src = e.currentTarget.dataset.src
    const urls = this.data.messages.filter(m => m.msg_type === 'image').map(m => m.content)
    wx.previewImage({ current: src, urls })
  },

  goBack() {
    wx.navigateBack()
  },

  goToUserProfile() {
    const { targetUser, targetUserId } = this.data
    const id = targetUser._id || targetUser.openid || targetUserId
    if (id) wx.navigateTo({ url: `/pages/community/user-profile?userId=${id}` })
  },

  onUnload() {
    this.data.watcher?.close()
  },

  onHide() {
    this.setData({ showEmojiPanel: false })
  }
})
