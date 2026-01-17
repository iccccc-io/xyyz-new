// 云函数入口文件 - 撤回聊天消息
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

/**
 * 撤回聊天消息云函数
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.msg_id - 要撤回的消息ID
 * 
 * @returns {Object} { success: Boolean, message: String }
 */
exports.main = async (event, context) => {
  const { msg_id } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log('[撤回消息] 开始处理:', { msg_id, openid })

  // ========== 1. 参数校验 ==========
  if (!msg_id) {
    return {
      success: false,
      message: '参数错误：缺少消息ID'
    }
  }

  try {
    // ========== 2. 查询消息 ==========
    const msgRes = await db.collection('chat_messages').doc(msg_id).get()
    
    if (!msgRes.data) {
      return {
        success: false,
        message: '消息不存在'
      }
    }

    const msg = msgRes.data

    // ========== 3. 权限校验：只能撤回自己的消息 ==========
    if (msg.sender_id !== openid) {
      return {
        success: false,
        message: '只能撤回自己发送的消息'
      }
    }

    // ========== 4. 时间校验：只能撤回2分钟内的消息 ==========
    const sendTime = new Date(msg.send_time).getTime()
    const now = Date.now()
    const timeDiff = now - sendTime
    const twoMinutes = 2 * 60 * 1000

    if (timeDiff > twoMinutes) {
      return {
        success: false,
        message: '消息发送已超过2分钟，无法撤回'
      }
    }

    // ========== 5. 检查是否已撤回 ==========
    if (msg.is_revoked) {
      return {
        success: false,
        message: '消息已撤回'
      }
    }

    // ========== 6. 执行撤回（逻辑删除）==========
    await db.collection('chat_messages').doc(msg_id).update({
      data: {
        is_revoked: true,
        revoke_time: db.serverDate()
      }
    })

    console.log('[撤回消息] 成功:', msg_id)

    return {
      success: true,
      message: '撤回成功'
    }

  } catch (err) {
    console.error('[撤回消息失败]', err)
    return {
      success: false,
      message: `撤回失败: ${err.message || '未知错误'}`
    }
  }
}

