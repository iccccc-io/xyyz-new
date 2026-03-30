// 云函数入口文件 - 私聊会话管理
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const DEFAULT_AVATAR = '/images/avatar.png'
const WAIT_TARGET_REPLY = 'WAIT_TARGET_REPLY'

exports.main = async (event, context) => {
  const { action } = event || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return fail('用户身份校验失败')
  }

  try {
    switch (action) {
      case 'get_meta':
        return success(await buildMetaPayload({ openid, ...event }))
      case 'follow':
        await followTarget({ openid, ...event })
        return success(await buildMetaPayload({ openid, ...event }))
      case 'unfollow':
        await unfollowTarget({ openid, ...event })
        return success(await buildMetaPayload({ openid, ...event }))
      case 'set_remark':
        await setRemarkName({ openid, ...event })
        return success(await buildMetaPayload({ openid, ...event }))
      case 'set_top':
        await setRoomBooleanState({ openid, field: 'is_top', ...event })
        return success(await buildMetaPayload({ openid, ...event }))
      case 'set_muted':
        await setRoomBooleanState({ openid, field: 'is_muted', ...event })
        return success(await buildMetaPayload({ openid, ...event }))
      case 'toggle_blacklist':
        await toggleBlacklist({ openid, ...event })
        return success(await buildMetaPayload({ openid, ...event }))
      case 'clear_history':
        await clearHistory({ openid, ...event })
        return success(await buildMetaPayload({ openid, ...event }))
      default:
        return fail('不支持的操作')
    }
  } catch (err) {
    console.error('[manage_chat_session] 执行失败:', action, err)
    return fail(err.message || '操作失败', err.code || '')
  }
}

function success(data) {
  return {
    success: true,
    data
  }
}

function fail(message, code = '') {
  return {
    success: false,
    message,
    code
  }
}

function buildRoomId(userA, userB) {
  return [userA, userB].sort().join('_')
}

function normalizeUser(user = {}, fallbackOpenid = '') {
  return {
    _id: user._id || '',
    openid: user._openid || fallbackOpenid || user._id || '',
    nickname: user.nickname || '用户',
    avatar_url: user.avatar_url || user.avatar || DEFAULT_AVATAR,
    blacklist: Array.isArray(user.blacklist) ? user.blacklist : [],
    stats: user.stats || {}
  }
}

async function getUserByIdentity(identity) {
  if (!identity) return null

  try {
    const docRes = await db.collection('users').doc(identity).get()
    if (docRes.data) {
      return normalizeUser(docRes.data)
    }
  } catch (err) {}

  const res = await db.collection('users')
    .where({ _openid: identity })
    .limit(1)
    .get()

  if (res.data && res.data.length) {
    return normalizeUser(res.data[0], identity)
  }

  return null
}

async function getCurrentUser(openid) {
  const user = await getUserByIdentity(openid)
  return user || normalizeUser({}, openid)
}

async function getRoom(roomId) {
  if (!roomId) return null
  try {
    const res = await db.collection('chat_rooms').doc(roomId).get()
    return res.data || null
  } catch (err) {
    return null
  }
}

function normalizeRoomUserInfo(uid, user) {
  return {
    uid,
    nickname: user?.nickname || '用户',
    avatar: user?.avatar_url || user?.avatar || DEFAULT_AVATAR
  }
}

async function ensureRoom({ openid, targetOpenid, roomId }) {
  const finalRoomId = roomId || buildRoomId(openid, targetOpenid)
  const existing = await getRoom(finalRoomId)
  if (existing) {
    return existing
  }

  const [currentUser, targetUser] = await Promise.all([
    getCurrentUser(openid),
    getUserByIdentity(targetOpenid)
  ])

  const roomData = {
    _id: finalRoomId,
    user_ids: [openid, targetOpenid].sort(),
    user_info: [
      normalizeRoomUserInfo(openid, currentUser),
      normalizeRoomUserInfo(targetOpenid, targetUser)
    ],
    unread_counts: {
      [openid]: 0,
      [targetOpenid]: 0
    },
    is_top: {
      [openid]: false,
      [targetOpenid]: false
    },
    is_muted: {
      [openid]: false,
      [targetOpenid]: false
    },
    clear_time: {
      [openid]: 0,
      [targetOpenid]: 0
    },
    create_time: db.serverDate(),
    update_time: db.serverDate()
  }

  try {
    await db.collection('chat_rooms').add({
      data: roomData
    })
  } catch (err) {
    if (err.errCode !== -502005) {
      throw err
    }
  }

  return (await getRoom(finalRoomId)) || roomData
}

async function getRelation(openid, targetOpenid) {
  const [followRes, followedBackRes] = await Promise.all([
    db.collection('community_follows')
      .where({
        follower_id: openid,
        target_id: targetOpenid
      })
      .limit(1)
      .get(),
    db.collection('community_follows')
      .where({
        follower_id: targetOpenid,
        target_id: openid
      })
      .limit(1)
      .get()
  ])

  const followDoc = followRes.data && followRes.data.length ? followRes.data[0] : null
  const isFollowing = !!followDoc
  const isFollowedByTarget = !!(followedBackRes.data && followedBackRes.data.length)

  return {
    isFollowing,
    isFollowedByTarget,
    isMutual: isFollowing && isFollowedByTarget,
    remarkName: followDoc?.remark_name || ''
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

async function getSendGate({ openid, targetOpenid, roomId, isMutual }) {
  if (isMutual) {
    return {
      canSend: true,
      reason: ''
    }
  }

  const latestMsg = await getLatestRoomMessage(roomId)
  if (latestMsg && latestMsg.sender_id === openid) {
    return {
      canSend: false,
      reason: WAIT_TARGET_REPLY
    }
  }

  return {
    canSend: true,
    reason: ''
  }
}

async function resolveTarget(openid, event) {
  const targetUser = await getUserByIdentity(event.target_user_id)
  const targetOpenid = targetUser?.openid || event.target_user_id || ''

  if (!targetOpenid) {
    throw new Error('缺少目标用户')
  }
  if (targetOpenid === openid) {
    throw new Error('不能操作自己')
  }

  return {
    targetUser: targetUser || normalizeUser({}, targetOpenid),
    targetOpenid,
    roomId: event.room_id || buildRoomId(openid, targetOpenid)
  }
}

async function buildMetaPayload({ openid, target_user_id, room_id }) {
  const currentUser = await getCurrentUser(openid)
  const { targetUser, targetOpenid, roomId } = await resolveTarget(openid, {
    target_user_id,
    room_id
  })
  const room = await getRoom(roomId)
  const relation = await getRelation(openid, targetOpenid)
  const sendGate = await getSendGate({
    openid,
    targetOpenid,
    roomId,
    isMutual: relation.isMutual
  })

  return {
    target_user: {
      _id: targetUser._id,
      openid: targetOpenid,
      nickname: targetUser.nickname,
      display_name: relation.remarkName || targetUser.nickname || '用户',
      avatar_url: targetUser.avatar_url || DEFAULT_AVATAR
    },
    relation: {
      is_following: relation.isFollowing,
      is_followed_by_target: relation.isFollowedByTarget,
      is_mutual: relation.isMutual,
      remark_name: relation.remarkName,
      has_blocked_target: currentUser.blacklist.includes(targetOpenid),
      is_blocked_by_target: targetUser.blacklist.includes(openid)
    },
    room: {
      room_id: roomId,
      unread_count: Number((room?.unread_counts && room.unread_counts[openid]) || 0),
      is_top: !!(room?.is_top && room.is_top[openid]),
      is_muted: !!(room?.is_muted && room.is_muted[openid]),
      clear_time: Number((room?.clear_time && room.clear_time[openid]) || 0),
      can_send: sendGate.canSend,
      send_disabled_reason: sendGate.reason
    }
  }
}

async function followTarget({ openid, target_user_id }) {
  const { targetOpenid } = await resolveTarget(openid, { target_user_id })
  const currentUser = await getUserByIdentity(openid)
  const targetUser = await getUserByIdentity(targetOpenid)

  if (!currentUser || !targetUser) {
    throw new Error('关注关系初始化失败，请先完善账号信息')
  }

  const existRes = await db.collection('community_follows')
    .where({
      follower_id: openid,
      target_id: targetOpenid
    })
    .limit(1)
    .get()

  if (!existRes.data || !existRes.data.length) {
    await db.collection('community_follows').add({
      data: {
        follower_id: openid,
        target_id: targetOpenid,
        remark_name: '',
        create_time: db.serverDate()
      }
    })

    await Promise.all([
      db.collection('users').doc(targetUser._id).update({
        data: {
          'stats.followers': _.inc(1)
        }
      }),
      db.collection('users').doc(currentUser._id).update({
        data: {
          'stats.following': _.inc(1)
        }
      })
    ])
  }
}

async function unfollowTarget({ openid, target_user_id }) {
  const { targetOpenid } = await resolveTarget(openid, { target_user_id })
  const currentUser = await getUserByIdentity(openid)
  const targetUser = await getUserByIdentity(targetOpenid)

  if (!currentUser || !targetUser) {
    throw new Error('取消关注失败，请稍后重试')
  }

  const existRes = await db.collection('community_follows')
    .where({
      follower_id: openid,
      target_id: targetOpenid
    })
    .limit(1)
    .get()

  if (existRes.data && existRes.data.length) {
    await db.collection('community_follows')
      .where({
        follower_id: openid,
        target_id: targetOpenid
      })
      .remove()

    await Promise.all([
      db.collection('users').doc(targetUser._id).update({
        data: {
          'stats.followers': _.inc(-1)
        }
      }),
      db.collection('users').doc(currentUser._id).update({
        data: {
          'stats.following': _.inc(-1)
        }
      })
    ])
  }
}

async function setRemarkName({ openid, target_user_id, remark_name }) {
  const { targetOpenid } = await resolveTarget(openid, { target_user_id })
  const trimmedRemark = String(remark_name || '').trim()

  const followRes = await db.collection('community_follows')
    .where({
      follower_id: openid,
      target_id: targetOpenid
    })
    .limit(1)
    .get()

  if (!followRes.data || !followRes.data.length) {
    const err = new Error('关注后才可以设置备注')
    err.code = 'NOT_FOLLOWING'
    throw err
  }

  await db.collection('community_follows')
    .where({
      follower_id: openid,
      target_id: targetOpenid
    })
    .update({
      data: {
        remark_name: trimmedRemark
      }
    })
}

async function setRoomBooleanState({ openid, target_user_id, room_id, field, value }) {
  if (typeof value !== 'boolean') {
    throw new Error('参数错误')
  }

  const { targetOpenid, roomId } = await resolveTarget(openid, {
    target_user_id,
    room_id
  })

  await ensureRoom({ openid, targetOpenid, roomId })
  await db.collection('chat_rooms').doc(roomId).update({
    data: {
      [`${field}.${openid}`]: value,
      update_time: db.serverDate()
    }
  })
}

async function toggleBlacklist({ openid, target_user_id, value }) {
  const { targetOpenid } = await resolveTarget(openid, { target_user_id })
  const currentUser = await getUserByIdentity(openid)

  if (!currentUser || !currentUser._id) {
    throw new Error('当前用户信息不存在')
  }

  const currentList = Array.isArray(currentUser.blacklist) ? currentUser.blacklist : []
  const shouldBlock = typeof value === 'boolean' ? value : !currentList.includes(targetOpenid)
  const nextList = shouldBlock
    ? Array.from(new Set([...currentList, targetOpenid]))
    : currentList.filter((item) => item !== targetOpenid)

  await db.collection('users').doc(currentUser._id).update({
    data: {
      blacklist: nextList
    }
  })
}

async function clearHistory({ openid, target_user_id, room_id }) {
  const { targetOpenid, roomId } = await resolveTarget(openid, {
    target_user_id,
    room_id
  })

  await ensureRoom({ openid, targetOpenid, roomId })
  await db.collection('chat_rooms').doc(roomId).update({
    data: {
      [`clear_time.${openid}`]: Date.now(),
      [`unread_counts.${openid}`]: 0,
      update_time: db.serverDate()
    }
  })
}
