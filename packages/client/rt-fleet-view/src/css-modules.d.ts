/** Ambient declarations for CSS module imports. */
declare module '*.module.css' {
  const classes: Record<string, string | undefined>
  export default classes
}
