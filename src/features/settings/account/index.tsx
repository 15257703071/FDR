import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'

export function SettingsAccount() {
  return (
    <ContentSection
      title='账户设置'
      desc='更新您的账户设置，设定您的偏好语言及系统时区。'
    >
      <AccountForm />
    </ContentSection>
  )
}
