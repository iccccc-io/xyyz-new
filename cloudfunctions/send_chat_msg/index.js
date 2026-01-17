// 云函数入口文件 - 发送聊天消息
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 发送聊天消息云函数
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.room_id - 会话房间ID
 * @param {String} event.target_user_id - 目标用户ID（openid）
 * @param {String} event.msg_type - 消息类型：'text' | 'image'
 * @param {String} event.content - 消息内容
 * @param {Object} event.quote_msg - 引用消息信息 {msg_id, sender_name, content}
 * @param {Object} event.user_info - 发送者信息 {nickname, avatar}
 * @param {Object} event.target_user_info - 接收者信息 {nickname, avatar}
 * 
 * @returns {Object} { success: Boolean, message: String, msgId: String }
 */
exports.main = async (event, context) => {
  const { room_id, target_user_id, msg_type, content, quote_msg, user_info, target_user_info } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log('[发送消息] 开始处理:', { room_id, msg_type, openid, target_user_id })

  // ========== 1. 参数校验 ==========
  if (!room_id || !target_user_id || !msg_type || !content) {
    return {
      success: false,
      message: '参数错误：缺少必要参数'
    }
  }

  if (!['text', 'image'].includes(msg_type)) {
    return {
      success: false,
      message: '参数错误：不支持的消息类型'
    }
  }

  // 不能给自己发消息
  if (target_user_id === openid) {
    return {
      success: false,
      message: '不能给自己发消息'
    }
  }

  try {
    // ========== 2. 内容安全审核（开发阶段暂时跳过）==========
    // TODO: 上线前恢复内容安全审核
    // if (msg_type === 'text') {
    //   const secCheckResult = await checkTextSecurity(content, openid)
    //   if (!secCheckResult.pass) {
    //     console.warn('[安全审核] 文本包含敏感内容:', content.substring(0, 50))
    //     return {
    //       success: false,
    //       message: secCheckResult.message || '消息包含敏感内容，请修改后重试'
    //     }
    //   }
    // }
    console.log('[安全审核] 开发阶段已跳过')

    // ========== 3. 写入消息记录 ==========
    const now = db.serverDate()
    const messageData = {
      room_id: room_id,
      sender_id: openid,
      msg_type: msg_type,
      content: content,
      send_time: now,
      is_revoked: false
    }
    
    // 如果有引用消息，添加引用信息
    if (quote_msg && quote_msg.msg_id) {
      messageData.quote_msg = {
        msg_id: quote_msg.msg_id,
        sender_name: quote_msg.sender_name || '',
        content: quote_msg.content || ''
      }
    }

    const msgResult = await db.collection('chat_messages').add({
      data: messageData
    })

    const msgId = msgResult._id
    console.log('[发送消息] 消息已写入:', msgId)

    // ========== 4. 更新/创建会话记录 ==========
    await updateChatRoom({
      room_id,
      openid,
      target_user_id,
      msg_type,
      content,
      user_info,
      target_user_info,
      now
    })

    return {
      success: true,
      message: '发送成功',
      msgId: msgId
    }

  } catch (err) {
    console.error('[发送消息失败]', err)
    return {
      success: false,
      message: `发送失败: ${err.message || '未知错误'}`
    }
  }
}

/**
 * 文本安全检测
 * @param {String} text - 待检测文本
 * @param {String} openid - 用户openid
 * @returns {Object} { pass: Boolean, message: String }
 */
async function checkTextSecurity(text, openid) {
  try {
    // 调用微信内容安全接口
    const result = await cloud.openapi.security.msgSecCheck({
      openid: openid,
      scene: 4, // 4 表示私信场景
      version: 2,
      content: text
    })

    console.log('[安全审核] 结果:', result)

    // result.result.label: 0-正常, 其他-违规
    if (result.result && result.result.label !== 0) {
      return {
        pass: false,
        message: '消息包含敏感内容'
      }
    }

    return { pass: true }
  } catch (err) {
    console.error('[安全审核] 调用失败:', err)
    // 审核失败时，根据策略决定是放行还是拦截
    // 这里选择放行，但记录日志
    return { pass: true }
  }
}

/**
 * 更新/创建会话记录
 */
async function updateChatRoom(params) {
  const { room_id, openid, target_user_id, msg_type, content, user_info, target_user_info, now } = params

  try {
    // 尝试更新现有会话
    const updateResult = await db.collection('chat_rooms').doc(room_id).update({
      data: {
        last_msg: {
          content: msg_type === 'text' ? content : '[图片]',
          time: now,
          sender_id: openid,
          msg_type: msg_type
        },
        update_time: now,
        // 接收方未读数 +1
        [`unread_counts.${target_user_id}`]: _.inc(1)
      }
    })

    if (updateResult.stats.updated > 0) {
      console.log('[会话] 更新成功')
      return
    }
  } catch (err) {
    // 会话不存在，需要创建
    console.log('[会话] 不存在，创建新会话')
  }

  // 创建新会话
  try {
    // 按字母序排列用户ID
    const sortedIds = [openid, target_user_id].sort()
    
    await db.collection('chat_rooms').add({
      data: {
        _id: room_id,
        user_ids: sortedIds,
        user_info: [
          {
            uid: openid,
            nickname: user_info?.nickname || '用户',
            avatar: user_info?.avatar || ''
          },
          {
            uid: target_user_id,
            nickname: target_user_info?.nickname || '用户',
            avatar: target_user_info?.avatar || ''
          }
        ],
        last_msg: {
          content: msg_type === 'text' ? content : '[图片]',
          time: now,
          sender_id: openid,
          msg_type: msg_type
        },
        unread_counts: {
          [openid]: 0,
          [target_user_id]: 1
        },
        create_time: now,
        update_time: now
      }
    })
    console.log('[会话] 创建成功:', room_id)
  } catch (err) {
    // 可能是并发创建导致的重复，忽略
    if (err.errCode === -502005) {
      console.log('[会话] 已存在，更新未读数')
      await db.collection('chat_rooms').doc(room_id).update({
        data: {
          last_msg: {
            content: msg_type === 'text' ? content : '[图片]',
            time: db.serverDate(),
            sender_id: openid,
            msg_type: msg_type
          },
          update_time: db.serverDate(),
          [`unread_counts.${target_user_id}`]: _.inc(1)
        }
      })
    } else {
      console.error('[会话] 创建失败:', err)
    }
  }
}

