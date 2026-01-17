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
    watcher: null,
    
    // 长按菜单相关
    showMsgMenu: false,
    menuMsg: null,
    menuPosition: { top: 0, left: 0 },
    
    // 引用相关
    quoteMsg: null
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
            if (c.queueType === 'enqueue') {
              this.onNewMsg(c.doc)
            } else if (c.queueType === 'update') {
              // 处理消息更新（如撤回）
              this.onMsgUpdate(c.doc)
            }
          })
        },
        onError: e => {
          console.error('watcher error:', e)
          setTimeout(() => this.startWatcher(), 3000)
        }
      })
  },

  // 处理消息更新（撤回等）
  onMsgUpdate(msg) {
    const { messages } = this.data
    const idx = messages.findIndex(m => m._id === msg._id)
    if (idx > -1) {
      const updated = [...messages]
      updated[idx] = { 
        ...updated[idx], 
        ...msg,
        showTime: updated[idx].showTime,
        timeStr: updated[idx].timeStr
      }
      this.setData({ messages: updated })
    }
  },

  onNewMsg(msg) {
    const { messages, currentUser } = this.data
    
    // 1. 检查是否已存在相同 _id 的消息
    if (messages.some(m => m._id === msg._id)) return

    // 2. 查找匹配的临时消息（自己发送的消息）
    // 对于图片消息，content 会从本地路径变成云存储 fileID，所以不能用 content 匹配
    // 改用 sender_id + msg_type + 时间接近（5秒内）+ status 为 uploading/sending
    const msgTime = new Date(msg.send_time).getTime()
    const tempIdx = messages.findIndex(m => {
      if (!m._tempId) return false
      if (m.sender_id !== msg.sender_id) return false
      if (m.msg_type !== msg.msg_type) return false
      if (m.status !== 'uploading' && m.status !== 'sending') return false
      
      // 文本消息可以精确匹配 content
      if (msg.msg_type === 'text' && m.content === msg.content) return true
      
      // 图片消息用时间接近来匹配（5秒内）
      if (msg.msg_type === 'image') {
        const tempTime = new Date(m.send_time).getTime()
        return Math.abs(msgTime - tempTime) < 5000
      }
      
      return false
    })

    if (tempIdx > -1) {
      // 找到临时消息，更新它，保留本地的 quote_msg（以防数据库返回延迟）
      const tempMsg = messages[tempIdx]
      const updated = [...messages]
      updated[tempIdx] = { 
        ...msg,
        quote_msg: msg.quote_msg || tempMsg.quote_msg, // 优先使用数据库的，否则保留本地的
        showTime: tempMsg.showTime, 
        timeStr: tempMsg.timeStr, 
        status: 'sent' 
      }
      this.setData({ messages: updated })
    } else {
      // 对方发送的新消息
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
    const { inputValue, roomId, currentUser, targetUser, messages, targetUserId, quoteMsg } = this.data
    const content = inputValue.trim()
    if (!content) return

    // 清空输入和引用
    this.setData({ inputValue: '', quoteMsg: null })

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
      status: 'sending',
      quote_msg: quoteMsg || null // 携带引用信息
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
          quote_msg: quoteMsg || null, // 传递引用信息到云函数
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
        else if (res.tapIndex === 1) this.chooseImage('camera')
      }
    })
  },

  async chooseImage(source) {
    try {
      const res = await wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sourceType: [source],
        sizeType: ['compressed'],
        maxDuration: 60
      })
      
      if (res.tempFiles && res.tempFiles.length > 0) {
        // 支持多张图片发送
        for (const file of res.tempFiles) {
          await this.sendImage(file.tempFilePath)
        }
      }
    } catch (e) {
      if (e.errMsg && !e.errMsg.includes('cancel')) {
        console.error('选择图片失败:', e)
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      }
    }
  },

  async sendImage(path) {
    const { roomId, currentUser, targetUser, targetUserId } = this.data
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date()

    console.log('[发送图片] 开始:', { path, roomId, currentUser: currentUser?.openid })

    // 获取图片扩展名
    const ext = path.split('.').pop().toLowerCase() || 'jpg'
    const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp']
    const finalExt = validExts.includes(ext) ? ext : 'jpg'

    const tempMsg = {
      _id: tempId,
      _tempId: tempId,
      room_id: roomId,
      sender_id: currentUser?.openid || '',
      msg_type: 'image',
      content: path,
      send_time: now.toISOString(),
      showTime: this.shouldShowTime(now),
      timeStr: this.shouldShowTime(now) ? this.formatTime(now) : '',
      status: 'uploading'
    }

    console.log('[发送图片] 临时消息:', tempMsg)

    const newMessages = [...this.data.messages, tempMsg]
    console.log('[发送图片] 更新消息列表, 长度:', newMessages.length)
    
    this.setData({ messages: newMessages })
    this.scrollToBottom()

    try {
      // 上传到云存储
      const cloudPath = `chat/${roomId}/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${finalExt}`
      
      const uploadRes = await wx.cloud.uploadFile({ 
        cloudPath, 
        filePath: path 
      })
      
      if (!uploadRes.fileID) {
        throw new Error('上传失败：未获取到 fileID')
      }
      
      const fileID = uploadRes.fileID

      // 调用云函数发送消息
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
        // 使用统一的更新函数，同时更新 content 为云存储 fileID
        this.updateMsgStatus(tempId, 'sent', res.result.msgId, fileID)
      } else {
        console.error('发送消息失败:', res.result?.message)
        this.updateMsgStatus(tempId, 'failed')
        wx.showToast({ title: res.result?.message || '发送失败', icon: 'none' })
      }
    } catch (e) {
      console.error('图片发送失败:', e)
      this.updateMsgStatus(tempId, 'failed')
      wx.showToast({ title: '图片发送失败', icon: 'none' })
    }
  },

  updateMsgStatus(tempId, status, realId, newContent) {
    const msgs = this.data.messages.map(m => {
      if (m._tempId === tempId) {
        const updated = { ...m, _id: realId || m._id, status }
        if (newContent) updated.content = newContent
        return updated
      }
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
    const urls = this.data.messages.filter(m => m.msg_type === 'image' && !m.is_revoked).map(m => m.content)
    wx.previewImage({ current: src, urls })
  },

  // ========== 长按菜单相关 ==========
  onMsgLongPress(e) {
    const msg = e.currentTarget.dataset.msg
    const { currentUser } = this.data
    if (!msg || msg.status === 'sending' || msg.status === 'uploading') return
    
    // 计算是否可以撤回（2分钟内）
    const sendTime = new Date(msg.send_time).getTime()
    const now = Date.now()
    const canRevoke = (now - sendTime) < 2 * 60 * 1000
    const isSelf = msg.sender_id === currentUser.openid
    
    // 先设置菜单数据，让菜单渲染出来
    this.setData({
      menuMsg: { ...msg, canRevoke, isSelf },
      showMsgMenu: false
    }, () => {
      setTimeout(() => {
        const query = wx.createSelectorQuery()
        query.select(`#msg-${msg._id}`).boundingClientRect()
        query.select('#menu-content').boundingClientRect()
        query.exec(res => {
          const rect = res[0]
          const menuRect = res[1]
          if (!rect) return
          
          const windowInfo = wx.getWindowInfo()
          const menuHeight = menuRect ? menuRect.height : 55
          const menuWidth = menuRect ? menuRect.width : 160
          const margin = 16 // 统一屏幕边距
          
          // 垂直位置
          let arrowPos = ''
          let top
          if (rect.top > menuHeight + this.data.navBarHeight + 20) {
            top = rect.top - menuHeight - 10
            arrowPos = ''
          } else {
            top = rect.bottom + 10
            arrowPos = 'arrow-top'
          }
          
          // 水平位置 - 统一边距 + 固定箭头位置
          let left, arrowLeft
          
          if (isSelf) {
            // 自己的消息（右侧）：菜单距离右边缘16px，箭头在右侧固定位置
            left = windowInfo.windowWidth - menuWidth - margin
            arrowLeft = menuWidth - 64 // 箭头距离菜单右边缘45px
          } else {
            // 对方的消息（左侧）：菜单距离左边缘16px，箭头在左侧固定位置
            left = margin
            arrowLeft = 64 // 箭头距离菜单左边缘45px
          }
          
          this.setData({
            showMsgMenu: true,
            menuPosition: { top, left, arrowLeft, arrowPos }
          })
          
          wx.vibrateShort({ type: 'medium' })
        })
      }, 50)
    })
  },

  closeMsgMenu() {
    this.setData({ showMsgMenu: false, menuMsg: null })
  },

  // 复制消息
  copyMessage() {
    const { menuMsg } = this.data
    if (menuMsg?.msg_type === 'text') {
      wx.setClipboardData({
        data: menuMsg.content,
        success: () => wx.showToast({ title: '已复制', icon: 'success' })
      })
    }
    this.closeMsgMenu()
  },

  // 转发消息
  forwardMessage() {
    wx.showToast({ title: '转发功能开发中', icon: 'none' })
    this.closeMsgMenu()
  },

  // 引用消息
  quoteMessage() {
    const { menuMsg, targetUser, currentUser } = this.data
    if (!menuMsg) return
    
    const senderName = menuMsg.sender_id === currentUser.openid 
      ? currentUser.nickname 
      : targetUser.nickname
    
    const content = menuMsg.msg_type === 'text' 
      ? menuMsg.content.substring(0, 50) + (menuMsg.content.length > 50 ? '...' : '')
      : '[图片]'
    
    this.setData({
      quoteMsg: {
        msg_id: menuMsg._id,
        sender_name: senderName,
        content: content
      },
      inputFocus: true
    })
    this.closeMsgMenu()
  },

  // 清除引用
  clearQuote() {
    this.setData({ quoteMsg: null })
  },

  // 滚动到被引用的消息
  scrollToQuote(e) {
    const msgId = e.currentTarget.dataset.id
    if (msgId) {
      this.setData({ scrollToView: `msg-${msgId}` })
      // 短暂高亮被引用的消息
      setTimeout(() => this.setData({ scrollToView: '' }), 500)
    }
  },

  // 撤回消息
  async revokeMessage() {
    const { menuMsg } = this.data
    if (!menuMsg) return
    
    this.closeMsgMenu()
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'revoke_chat_msg',
        data: { msg_id: menuMsg._id }
      })
      
      if (res.result?.success) {
        // 本地立即更新（乐观更新，watcher 也会同步）
        const messages = this.data.messages.map(m => {
          if (m._id === menuMsg._id) {
            return { ...m, is_revoked: true }
          }
          return m
        })
        this.setData({ messages })
        wx.showToast({ title: '已撤回', icon: 'success' })
      } else {
        wx.showToast({ title: res.result?.message || '撤回失败', icon: 'none' })
      }
    } catch (e) {
      console.error('撤回失败:', e)
      wx.showToast({ title: '撤回失败', icon: 'none' })
    }
  },

  // 删除消息（本地删除，不影响对方）
  deleteMessage() {
    const { menuMsg } = this.data
    if (!menuMsg) return
    
    this.closeMsgMenu()
    
    wx.showModal({
      title: '删除消息',
      content: '确定要删除这条消息吗？仅从您的设备删除',
      success: (res) => {
        if (res.confirm) {
          const messages = this.data.messages.filter(m => m._id !== menuMsg._id)
          this.setData({ messages })
          wx.showToast({ title: '已删除', icon: 'success' })
        }
      }
    })
  },

  // 举报消息
  reportMessage() {
    const { menuMsg, roomId } = this.data
    if (!menuMsg) return
    
    this.closeMsgMenu()
    
    wx.showModal({
      title: '举报消息',
      content: '确定要举报这条消息吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await wx.cloud.callFunction({
              name: 'report_content',
              data: {
                type: 'chat_message',
                target_id: menuMsg._id,
                room_id: roomId,
                content: menuMsg.content,
                reason: '违规内容'
              }
            })
            wx.showToast({ title: '举报成功', icon: 'success' })
          } catch (e) {
            wx.showToast({ title: '举报失败', icon: 'none' })
          }
        }
      }
    })
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
