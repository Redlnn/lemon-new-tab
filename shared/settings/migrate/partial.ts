/** 同步只携带部分设置；迁移函数必须保留字段缺失语义。 */
export type PartialSettings<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? PartialSettings<T[K]>
      : T[K]
}
