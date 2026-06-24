import { ContentSection } from '../components/content-section'
import { DisplayForm } from './display-form'

export function SettingsDisplay() {
  return (
    <ContentSection
      title='显示设置'
      desc='选择或取消选中项目，以控制在系统中显示的内容。'
    >
      <DisplayForm />
    </ContentSection>
  )
}
