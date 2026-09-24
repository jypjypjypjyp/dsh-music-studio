/** CSS Modules 的类名映射（构建时由 tsdown.config.ts 里的虚拟加载器生成）。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
