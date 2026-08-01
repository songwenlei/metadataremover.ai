# MetadataRemover.ai 开源工具计划

## 定位

本仓库是 [MetadataRemover.ai](https://metadataremover.ai/) 的开源配套工具集：

- 网站服务普通用户，提供无需安装的浏览器体验；
- GitHub 工具服务开发者、自动化和本地工作流；
- 两者坚持本地处理、默认无上传、无遥测；
- 每个工具必须独立有用，不能只是为了放置网站链接。

## 长期同步约定

网站每增加一个适合本地化、命令行化或自动化的新能力，仓库应评估并增加对应的小工具或子命令。

同步功能的完成标准：

1. 有明确、独立的使用场景；
2. 有自动化测试和技术边界说明；
3. README 或对应文档中有入口；
4. 清楚标注对应的在线版本链接；
5. GitHub 链接使用可识别来源的 UTM 参数；
6. JSON 等机器输出不混入推广信息；
7. 不默认上传文件，不默认收集遥测。

README、工具文档、示例、Release Notes 和包元数据都可以加入站点链接。链接应作为“在线使用”“继续清理”“查看完整说明”等自然下一步，而不是重复堆砌。

## 已同步工具

Image Metadata Privacy Checker 对应网站首页的图片元数据能力，负责本地检查：

- JPEG：EXIF、GPS、XMP、IPTC、Comment、JUMBF；
- PNG：eXIf、文本块、XMP、AI 生成参数、C2PA `caBX`；
- WebP：EXIF、XMP、AI 生成参数和 C2PA；
- ICC 色彩配置只做信息提示，不作为隐私风险。

检查器发现风险后，引导用户前往首页的在线清理器。机器可读的 JSON 输出不包含推广链接。

网站新增的两个公开工具也已同步到本地：

- `metadata-view` 对应 Metadata Viewer，读取支持的 EXIF/GPS 字段、PNG 文本、XMP 原始包、容器与来源标记，并支持 JSON/CSV 导出；
- `exif-remove` 对应 EXIF Remover，无损移除 JPEG APP1、PNG `eXIf`、WebP `EXIF` 容器并复扫验证；非标准 Orientation 默认拒绝，避免静默改变显示方向。

对应在线入口：

- `https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer`
- `https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover`

## 后续路线图

1. 本地通用 `clean`：在 EXIF-only 之外，无损移除更多支持的隐私元数据；
2. `verify`：对比清理前后并生成验证报告；
3. `scan`：递归扫描目录中的图片风险；
4. GitHub Action：阻止含敏感元数据的图片进入仓库；
5. Pre-commit Hook：提交前自动检查；
6. C2PA/JUMBF 检测增强，但在实现密码学验证前不宣称签名有效性验证；
7. 网站新增格式或能力后，同步增加对应命令或工具。

## 网站链接规范

站点 canonical URL：

`https://metadataremover.ai/`

当前 GitHub 工具的在线清理入口：

`https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker`

包的 `homepage` 使用 canonical URL；README、文档和 CLI 的人类可读提示可使用 UTM 链接。不得在 JSON 输出中加入营销字段。
