import api from '@/api'
import { storage } from '@/storage'

/**
 * Add a message to a group, or take it out. Ids are quoted, as every 128-bit id must be. A server
 * from before quoted group ids were accepted (OpenNeutron PR #3) answers 400 to that, so the call
 * is made once more with bare digits: the app keeps working whichever is deployed first.
 *
 * @param {'add'|'remove'} action
 */
export async function groupEmail(action, groupUid, emailUid) {
  const path = action === 'add' ? '/group/add-email' : '/group/remove-email'
  const config = { headers: { Authorization: `Bearer ${storage.getToken()}` } }
  try {
    return await api.post(path, `{"group_uid":"${groupUid}","email_uid":"${emailUid}"}`, config)
  } catch (error) {
    if (error?.response?.status !== 400 || !/^\d+$/.test(String(groupUid)) || !/^\d+$/.test(String(emailUid))) throw error
    return api.post(path, `{"group_uid":${groupUid},"email_uid":${emailUid}}`, config)
  }
}
