import { ContentSection } from '../components/content-section'
import { ProfileForm } from './profile-form'

export function SettingsProfile() {
  return (
    <ContentSection title='个人信息' desc='这是您在平台上的公开展示信息。'>
      <ProfileForm />
    </ContentSection>
  )
}
