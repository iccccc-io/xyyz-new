// 云函数入口文件 - 发送聊天消息
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const DEFAULT_AVATAR = '/images/avatar.png'
const CODE_BLACKLIST_REJECTED = 'BLACKLIST_REJECTED'
const CODE_WAIT_TARGET_REPLY = 'WAIT_TARGET_REPLY'

exports.main = async (event, context) => {
  const {
    room_id,
    target_user_id,
    msg_type,
    content,
    quote_msg,
    user_info,
    target_user_info
  } = event || {}

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log('[发送消息] 开始处理:', { room_id, msg_type, openid, target_user_id })

  if (!room_id || !target_user_id || !msg_type || typeof content === 'undefined') {
    return fail('参数错误：缺少必要参数')
  }

  if (!['text', 'image'].includes(msg_type)) {
    return fail('参数错误：不支持的消息类型')
  }

  if (target_user_id === openid) {
    return fail('不能给自己发消息')
  }

  const normalizedContent = normalizeContent(content, msg_type)
  if (!normalizedContent) {
    return fail('消息内容不能为空')
  }

  try {
    const targetUser = await getUserByIdentity(target_user_id)
    const targetOpenid = targetUser?.openid || target_user_id

    if (targetOpenid === openid) {
      return fail('不能给自己发消息')
    }

    if (await isBlockedByTarget({ senderOpenid: openid, targetUser })) {
      return fail('消息已发出，但被对方拒收', CODE_BLACKLIST_REJECTED)
    }

    const relation = await getFollowRelation(openid, targetOpenid)
    if (!relation.isMutual) {
      const latestMsg = await getLatestRoomMessage(room_id)
      if (latestMsg && latestMsg.sender_id === openid) {
        return fail(
          '由于对方未关注你，需等待对方回复后才能继续发送',
          CODE_WAIT_TARGET_REPLY
        )
      }
    }

    const now = db.serverDate()
    const messageData = {
      room_id,
      sender_id: openid,
      msg_type,
      content: normalizedContent,
      send_time: now,
      is_revoked: false
    }

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

    await updateChatRoom({
      room_id,
      senderOpenid: openid,
      targetOpenid,
      msg_type,
      content: normalizedContent,
      user_info,
      target_user_info,
      targetUser,
      now
    })

    return {
      success: true,
      message: '发送成功',
      code: 'OK',
      msgId: msgResult._id
    }
  } catch (err) {
    console.error('[发送消息失败]', err)
    return fail(`发送失败: ${err.message || '未知错误'}`)
  }
}

function fail(message, code = '') {
  return {
    success: false,
    message,
    code
  }
}

function normalizeContent(content, msgType) {
  if (typeof content !== 'string') return ''
  return msgType === 'text' ? content.trim() : content
}

function buildRoomId(userA, userB) {
  return [userA, userB].sort().join('_')
}

async function getUserByIdentity(identity) {
  if (!identity) return null

  try {
    const docRes = await db.collection('users').doc(identity).get()
    if (docRes.data) {
      return normalizeUser(docRes.data)
    }
  } catch (err) {}

  const queryRes = await db.collection('users')
    .where({ _openid: identity })
    .limit(1)
    .get()

  if (queryRes.data && queryRes.data.length) {
    return normalizeUser(queryRes.data[0])
  }

  return null
}

function normalizeUser(user = {}) {
  return {
    _id: user._id || '',
    openid: user._openid || user._id || '',
    nickname: user.nickname || '用户',
    avatar: user.avatar_url || user.avatar || DEFAULT_AVATAR,
    blacklist: Array.isArray(user.blacklist) ? user.blacklist : []
  }
}

async function isBlockedByTarget({ senderOpenid, targetUser }) {
  if (!targetUser) return false
  const blacklist = Array.isArray(targetUser.blacklist) ? targetUser.blacklist : []
  return blacklist.includes(senderOpenid)
}

async function getFollowRelation(openid, targetOpenid) {
  const [followingRes, followedBackRes] = await Promise.all([
    db.collection('community_follows')
      .where({ follower_id: openid, target_id: targetOpenid })
      .limit(1)
      .get(),
    db.collection('community_follows')
      .where({ follower_id: targetOpenid, target_id: openid })
      .limit(1)
      .get()
  ])

  const isFollowing = !!(followingRes.data && followingRes.data.length)
  const isFollowedByTarget = !!(followedBackRes.data && followedBackRes.data.length)

  return {
    isFollowing,
    isFollowedByTarget,
    isMutual: isFollowing && isFollowedByTarget
  }
}

async function getLatestRoomMessage(roomId) {
  const res = await db.collection('chat_messages')
    .where({ room_id: roomId })
    .orderBy('send_time', 'desc')
    .limit(1)
    .get()

  return res.data && res.data.length ? res.data[0] : null
}

async function getRoom(roomId) {
  try {
    const res = await db.collection('chat_rooms').doc(roomId).get()
    return res.data || null
  } catch (err) {
    return null
  }
}

function normalizeUserInfo(uid, localInfo, fallbackUser) {
  return {
    uid,
    nickname: localInfo?.nickname || fallbackUser?.nickname || '用户',
    avatar: localInfo?.avatar || fallbackUser?.avatar || DEFAULT_AVATAR
  }
}

async function updateChatRoom(params) {
  const {
    room_id,
    senderOpenid,
    targetOpenid,
    msg_type,
    content,
    user_info,
    target_user_info,
    targetUser,
    now
  } = params

  const currentUser = await getUserByIdentity(senderOpenid)
  const senderProfile = normalizeUser(currentUser || { _openid: senderOpenid })
  const targetProfile = normalizeUser(targetUser || { _openid: targetOpenid })
  const roomDoc = await getRoom(room_id)
  const finalRoomId = room_id || buildRoomId(senderOpenid, targetOpenid)
  const roomUserInfo = [
    normalizeUserInfo(senderOpenid, user_info, senderProfile),
    normalizeUserInfo(targetOpenid, target_user_info, targetProfile)
  ]
  const lastMsg = {
    content: msg_type === 'text' ? content : '[图片]',
    time: now,
    sender_id: senderOpenid,
    msg_type
  }

  if (roomDoc) {
    const nextTargetUnread = Number(
      (roomDoc.unread_counts && roomDoc.unread_counts[targetOpenid]) || 0
    ) + 1

    const updateData = {
      user_info: roomUserInfo,
      last_msg: lastMsg,
      update_time: now,
      [`unread_counts.${targetOpenid}`]: nextTargetUnread
    }

    if (!roomDoc.unread_counts || typeof roomDoc.unread_counts[senderOpenid] === 'undefined') {
      updateData[`unread_counts.${senderOpenid}`] = 0
    }
    if (!roomDoc.is_top || typeof roomDoc.is_top[senderOpenid] === 'undefined') {
      updateData[`is_top.${senderOpenid}`] = false
    }
    if (!roomDoc.is_top || typeof roomDoc.is_top[targetOpenid] === 'undefined') {
      updateData[`is_top.${targetOpenid}`] = false
    }
    if (!roomDoc.is_muted || typeof roomDoc.is_muted[senderOpenid] === 'undefined') {
      updateData[`is_muted.${senderOpenid}`] = false
    }
    if (!roomDoc.is_muted || typeof roomDoc.is_muted[targetOpenid] === 'undefined') {
      updateData[`is_muted.${targetOpenid}`] = false
    }
    if (!roomDoc.clear_time || typeof roomDoc.clear_time[senderOpenid] === 'undefined') {
      updateData[`clear_time.${senderOpenid}`] = 0
    }
    if (!roomDoc.clear_time || typeof roomDoc.clear_time[targetOpenid] === 'undefined') {
      updateData[`clear_time.${targetOpenid}`] = 0
    }

    await db.collection('chat_rooms').doc(finalRoomId).update({
      data: updateData
    })
    return
  }

  const roomData = {
    _id: finalRoomId,
    user_ids: [senderOpenid, targetOpenid].sort(),
    user_info: roomUserInfo,
    last_msg: lastMsg,
    unread_counts: {
      [senderOpenid]: 0,
      [targetOpenid]: 1
    },
    is_top: {
      [senderOpenid]: false,
      [targetOpenid]: false
    },
    is_muted: {
      [senderOpenid]: false,
      [targetOpenid]: false
    },
    clear_time: {
      [senderOpenid]: 0,
      [targetOpenid]: 0
    },
    create_time: now,
    update_time: now
  }

  try {
    await db.collection('chat_rooms').add({
      data: roomData
    })
  } catch (err) {
    if (err.errCode !== -502005) {
      throw err
    }

    const existingRoom = await getRoom(finalRoomId)
    const nextTargetUnread = Number(
      (existingRoom?.unread_counts && existingRoom.unread_counts[targetOpenid]) || 0
    ) + 1

    await db.collection('chat_rooms').doc(finalRoomId).update({
      data: {
        user_info: roomUserInfo,
        last_msg: lastMsg,
        update_time: db.serverDate(),
        [`unread_counts.${targetOpenid}`]: nextTargetUnread,
        [`unread_counts.${senderOpenid}`]:
          typeof existingRoom?.unread_counts?.[senderOpenid] === 'undefined'
            ? 0
            : existingRoom.unread_counts[senderOpenid],
        [`is_top.${senderOpenid}`]:
          typeof existingRoom?.is_top?.[senderOpenid] === 'undefined'
            ? false
            : !!existingRoom.is_top[senderOpenid],
        [`is_top.${targetOpenid}`]:
          typeof existingRoom?.is_top?.[targetOpenid] === 'undefined'
            ? false
            : !!existingRoom.is_top[targetOpenid],
        [`is_muted.${senderOpenid}`]:
          typeof existingRoom?.is_muted?.[senderOpenid] === 'undefined'
            ? false
            : !!existingRoom.is_muted[senderOpenid],
        [`is_muted.${targetOpenid}`]:
          typeof existingRoom?.is_muted?.[targetOpenid] === 'undefined'
            ? false
            : !!existingRoom.is_muted[targetOpenid],
        [`clear_time.${senderOpenid}`]:
          typeof existingRoom?.clear_time?.[senderOpenid] === 'undefined'
            ? 0
            : Number(existingRoom.clear_time[senderOpenid] || 0),
        [`clear_time.${targetOpenid}`]:
          typeof existingRoom?.clear_time?.[targetOpenid] === 'undefined'
            ? 0
            : Number(existingRoom.clear_time[targetOpenid] || 0)
      }
    })
  }
}
