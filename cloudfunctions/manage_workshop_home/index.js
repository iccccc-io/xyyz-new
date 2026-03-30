const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const TEXT_SEC_SCENE = 3
const IMAGE_SEC_SCENE = 3
const RENAME_LIMIT_MS = 30 * 24 * 60 * 60 * 1000

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isCloudFileId(value) {
  return typeof value === 'string' && value.startsWith('cloud://')
}

function getWorkshopOwnerOpenid(workshop) {
  return getSafeString(workshop && (workshop.owner_openid || workshop.owner_id))
}

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function diffDaysLeft(lastRenameTime) {
  const lastDate = toDate(lastRenameTime)
  if (!lastDate) return 0
  const remainMs = RENAME_LIMIT_MS - (Date.now() - lastDate.getTime())
  if (remainMs <= 0) return 0
  return Math.ceil(remainMs / (24 * 60 * 60 * 1000))
}

async function checkTextSecurity(text, openid, message) {
  const content = getSafeString(text)
  if (!content) return

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: TEXT_SEC_SCENE,
      version: 2,
      content
    })

    if ((res && res.errCode && res.errCode !== 0) || (res && res.result && res.result.label !== 0)) {
      throw new Error(message)
    }
  } catch (err) {
    if (err && (err.errCode === 87014 || /敏感|risky/i.test(err.errMsg || ''))) {
      throw new Error(message)
    }
    console.error('[manage_workshop_home] 文本安全校验失败:', err)
    throw new Error('内容安全校验失败，请稍后重试')
  }
}

async function checkImagesSecurity(fileIds, openid, message) {
  const cloudFileIds = (Array.isArray(fileIds) ? fileIds : []).filter(isCloudFileId)
  if (!cloudFileIds.length) return

  try {
    const tempRes = await cloud.getTempFileURL({
      fileList: cloudFileIds
    })
    const tempUrls = (tempRes.fileList || [])
      .map((item) => item && item.tempFileURL)
      .filter(Boolean)

    for (const mediaUrl of tempUrls) {
      const res = await cloud.openapi.security.mediaCheckAsync({
        openid,
        scene: IMAGE_SEC_SCENE,
        version: 2,
        mediaType: 2,
        mediaUrl
      })

      if ((res && res.errCode && res.errCode !== 0) || (res && res.result && res.result.label !== 0)) {
        throw new Error(message)
      }
    }
  } catch (err) {
    if (err && (err.errCode === 87014 || /敏感|risky/i.test(err.errMsg || ''))) {
      throw new Error(message)
    }
    console.error('[manage_workshop_home] 图片安全校验失败:', err)
    throw new Error('图片安全校验失败，请稍后重试')
  }
}

async function getWorkshopById(workshopId) {
  const workshopRes = await db.collection('shopping_workshops').doc(workshopId).get()
  const workshop = workshopRes.data
  if (!workshop) {
    throw new Error('工坊不存在')
  }
  return workshop
}

async function ensureWorkshopOwner(workshopId, openid) {
  if (!openid) {
    throw new Error('请先登录后再操作')
  }

  const workshop = await getWorkshopById(workshopId)
  if (getWorkshopOwnerOpenid(workshop) !== openid) {
    throw new Error('仅工坊主可修改工坊资料')
  }
  return workshop
}

async function ensureWorkshopNameUnique(name, excludeId = '') {
  const where = excludeId
    ? { name, _id: _.neq(excludeId) }
    : { name }

  const countRes = await db.collection('shopping_workshops')
    .where(where)
    .count()

  if ((countRes.total || 0) > 0) {
    throw new Error('工坊名称已被使用，请更换一个名字')
  }
}

function sanitizeWorkshop(workshop) {
  if (!workshop) return null
  return {
    _id: workshop._id,
    name: getSafeString(workshop.name),
    logo: getSafeString(workshop.logo),
    desc: getSafeString(workshop.desc),
    cover_url: getSafeString(workshop.cover_url),
    last_rename_time: workshop.last_rename_time || null,
    ich_category: getSafeString(workshop.ich_category),
    owner_openid: getWorkshopOwnerOpenid(workshop)
  }
}

async function syncWorkshopNameReferences(workshopId, nextName) {
  await Promise.all([
    db.collection('shopping_products')
      .where({ workshop_id: workshopId })
      .update({
        data: {
          workshop_name: nextName,
          update_time: db.serverDate()
        }
      })
      .catch((err) => {
        console.error('[manage_workshop_home] 商品工坊名同步失败:', err)
        throw new Error('工坊名称同步失败，请稍后重试')
      }),
    db.collection('shopping_orders')
      .where({ workshop_id: workshopId })
      .update({
        data: {
          'product_snapshot.workshop_name': nextName,
          update_time: db.serverDate()
        }
      })
      .catch((err) => {
        console.error('[manage_workshop_home] 订单快照工坊名同步失败:', err)
        throw new Error('订单中的工坊名称同步失败，请稍后重试')
      })
  ])
}

async function getInfo(event, openid) {
  const workshopId = getSafeString(event.workshop_id)
  const workshop = await ensureWorkshopOwner(workshopId, openid)

  return {
    success: true,
    workshop: sanitizeWorkshop(workshop)
  }
}

async function updateInfo(event, openid) {
  const workshopId = getSafeString(event.workshop_id)
  const workshop = await ensureWorkshopOwner(workshopId, openid)

  const nextName = getSafeString(event.name)
  const nextLogo = getSafeString(event.logo)
  const nextDesc = getSafeString(event.desc)
  const nextCoverUrl = getSafeString(event.cover_url)

  if (!nextName || !nextLogo || !nextDesc) {
    throw new Error('工坊名称、Logo 和主理人寄语不能为空')
  }
  if (nextName.length < 2 || nextName.length > 20) {
    throw new Error('工坊名称需控制在 2-20 个字之间')
  }
  if (nextDesc.length < 10 || nextDesc.length > 300) {
    throw new Error('主理人寄语需控制在 10-300 个字之间')
  }
  if (!isCloudFileId(nextLogo)) {
    throw new Error('工坊 Logo 无效，请重新上传')
  }
  if (nextCoverUrl && !isCloudFileId(nextCoverUrl)) {
    throw new Error('工坊背景图无效，请重新上传')
  }

  const renameChanged = nextName !== getSafeString(workshop.name)
  if (renameChanged) {
    const daysLeft = diffDaysLeft(workshop.last_rename_time)
    if (daysLeft > 0) {
      throw new Error(`工坊名称 30 天内仅可修改一次，请 ${daysLeft} 天后再试`)
    }
    await ensureWorkshopNameUnique(nextName, workshopId)
  }

  await checkTextSecurity(nextName, openid, '工坊名称包含敏感信息，请修改后重试')
  await checkTextSecurity(nextDesc, openid, '主理人寄语包含敏感信息，请修改后重试')
  await checkImagesSecurity([nextLogo], openid, '工坊 Logo 未通过审核，请更换后重试')
  if (nextCoverUrl) {
    await checkImagesSecurity([nextCoverUrl], openid, '工坊背景图未通过审核，请更换后重试')
  }

  const updateData = {
    name: nextName,
    logo: nextLogo,
    desc: nextDesc,
    cover_url: nextCoverUrl,
    update_time: db.serverDate()
  }

  if (renameChanged) {
    updateData.last_rename_time = db.serverDate()
  }

  await db.collection('shopping_workshops').doc(workshopId).update({
    data: updateData
  })

  if (renameChanged) {
    await syncWorkshopNameReferences(workshopId, nextName)
  }

  const nextWorkshop = await getWorkshopById(workshopId)
  return {
    success: true,
    message: '工坊资料已更新',
    workshop: sanitizeWorkshop(nextWorkshop)
  }
}

async function updateCover(event, openid) {
  const workshopId = getSafeString(event.workshop_id)
  const workshop = await ensureWorkshopOwner(workshopId, openid)
  const coverUrl = getSafeString(event.cover_url)

  if (!coverUrl || !isCloudFileId(coverUrl)) {
    throw new Error('封面图片无效')
  }

  await checkImagesSecurity([coverUrl], openid, '工坊背景图未通过审核，请更换后重试')

  await db.collection('shopping_workshops').doc(workshopId).update({
    data: {
      cover_url: coverUrl,
      update_time: db.serverDate()
    }
  })

  return {
    success: true,
    message: '封面已更新',
    cover_url: coverUrl,
    workshop: sanitizeWorkshop({
      ...workshop,
      cover_url: coverUrl
    })
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = getSafeString(event.action)

  try {
    switch (action) {
      case 'get_info':
        return await getInfo(event, OPENID)
      case 'update_info':
        return await updateInfo(event, OPENID)
      case 'update_cover':
        return await updateCover(event, OPENID)
      default:
        return {
          success: false,
          message: '不支持的操作类型'
        }
    }
  } catch (err) {
    console.error('[manage_workshop_home]', err)
    return {
      success: false,
      message: err.message || '工坊主页操作失败'
    }
  }
}
