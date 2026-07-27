import { supabase } from './supabase'

/** Uploads a profile photo to the given public Storage bucket and returns its public URL. */
export async function uploadProfilePhoto(bucket: string, folder: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file)
  if (error) throw error
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
