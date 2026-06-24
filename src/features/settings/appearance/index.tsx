import { ContentSection } from '../components/content-section'
import { AppearanceForm } from './appearance-form'

export function SettingsAppearance() {
  return (
    <ContentSection
      title='外观设置'
      desc='自定义系统的界面外观，在白昼和黑夜主题之间自由切换。'
    >
      <AppearanceForm />
    </ContentSection>
  )
}
