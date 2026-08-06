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

网站第一批新增的三个公开工具已同步到本地：

- `metadata-view` 对应 Metadata Viewer，读取支持的 EXIF/GPS 字段、PNG 文本、XMP 原始包、容器与来源标记，并支持 JSON/CSV 导出；
- `ai-metadata-remove` 对应 AI Metadata Remover，只移除识别到的 AI 标记 PNG 文本与 XMP 容器，保留独立 EXIF、IPTC、C2PA 和 ICC，并复扫验证；
- `exif-remove` 对应 EXIF Remover，无损移除 JPEG APP1、PNG `eXIf`、WebP `EXIF` 容器并复扫验证；非标准 Orientation 默认拒绝，避免静默改变显示方向。

对应在线入口：

- `https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer`
- `https://metadataremover.ai/ai-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=ai_metadata_remover`
- `https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover`

2026-08-06 上线的 PDF 查看、编辑和移除能力也已经同步为三个精简命令：

- `pdf-metadata-view`：读取 PDF Info、受限大小的文档 XMP、页数、SHA-256 与签名边界；签名只做结构检测，不验证证书信任；
- `pdf-metadata-edit`：只修改支持的 PDF Info 字段，保留 XMP，写入后逐字段复读并核对页数；
- `pdf-metadata-remove`：移除完整 Info 字典和文档级 XMP，完整重写后复读验证；
- 两个写命令都拒绝加密文件和检测到签名边界的文件，不提供静默破坏签名的参数；
- 三个命令都不把页面正文、注释、附件、JavaScript、隐藏层或嵌入图片元数据包装成“已经清理”。

对应在线入口：

- `https://metadataremover.ai/pdf-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_viewer`
- `https://metadataremover.ai/pdf-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_editor`
- `https://metadataremover.ai/pdf-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_remover`

图片 Metadata Editor 暂不复制为不完整的命令。跨 JPEG、PNG、WebP 安全写入 EXIF/GPS/XMP，同时保留方向、未知字段、IPTC、色彩和来源容器，需要经过独立的容器写入与像素方向验证；在这些条件具备前，只保留在线编辑入口，避免发布会静默丢字段或改变显示方向的半成品。

## 后续路线图

1. 本地通用 `clean`：在 EXIF-only 之外，无损移除更多支持的图片隐私元数据；
2. 安全的图片 Info/XMP 编辑子集，在实现前先补齐跨格式保留与方向测试；
3. `verify`：对比清理前后并生成验证报告；
4. `scan`：递归扫描目录中的图片和 PDF 风险；
5. GitHub Action：阻止含敏感元数据的文件进入仓库；
6. Pre-commit Hook：提交前自动检查；
7. C2PA/JUMBF 与 PDF 签名边界检测增强，但在实现密码学验证前不宣称签名有效性验证；
8. 网站新增格式或能力后，同步增加对应命令或工具。

## 网站链接规范

站点 canonical URL：

`https://metadataremover.ai/`

当前 GitHub 工具的在线清理入口：

`https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker`

包的 `homepage` 使用 canonical URL；README、文档和 CLI 的人类可读提示可使用 UTM 链接。不得在 JSON 输出中加入营销字段。
