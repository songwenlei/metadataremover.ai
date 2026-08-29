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

Image Metadata Privacy Checker 负责本地检查：

- JPEG：EXIF、GPS、XMP、IPTC、Comment、JUMBF；
- PNG：eXIf、文本块、XMP、AI 生成参数、C2PA `caBX`；
- WebP：EXIF、XMP、AI 生成参数和 C2PA；
- ICC 色彩配置只做信息提示，不作为隐私风险。

检查器发现风险后，可以交给精简的本地通用清理命令，也可以引导用户前往首页完成可视化清理。机器可读的 JSON 输出不包含推广链接。

网站第一批新增的三个公开工具已同步到本地：

- `metadata-view` 对应 Metadata Viewer，读取支持的 EXIF/GPS 字段、PNG 文本、XMP 原始包、容器与来源标记，并支持 JSON/CSV 导出；
- `ai-metadata-remove` 对应 AI Metadata Remover，只移除识别到的 AI 标记 PNG 文本与 XMP 容器，保留独立 EXIF、IPTC、C2PA 和 ICC，并复扫验证；
- `exif-remove` 对应 EXIF Remover，无损移除 JPEG APP1、PNG `eXIf`、WebP `EXIF` 容器并复扫验证；非标准 Orientation 默认拒绝，避免静默改变显示方向。

2026-08-29 又补齐首页通用清理与 Image Metadata Editor 的精简对应命令：

- `metadata-remove`：移除已支持的 EXIF、XMP、IPTC、JPEG Comment、PNG 文本和 C2PA/JUMBF 容器，保留 ICC 与像素载荷；非标准 Orientation 默认拒绝；
- `metadata-edit`：只修改或清除源文件中已经存在的 IFD0 EXIF ASCII 标题、作者、版权和日期槽位；不新增字段、不扩容、不写 Unicode/GPS/XMP/IPTC，写入后复读全部目标值；
- 两者一次只处理一个文件；批量、可视化 diff、新增字段、变长值和更完整的跨命名空间编辑继续保留在线版。

对应在线入口：

- `https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer`
- `https://metadataremover.ai/ai-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=ai_metadata_remover`
- `https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover`
- `https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_remover`
- `https://metadataremover.ai/metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=metadata_editor`

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

2026-08-08 上线的 DOCX 查看/移除能力与 2026-08-22 上线的编辑能力已同步为三个精简命令：

- `docx-metadata-view`：读取 Core、Extended、Custom Properties，评论/修订身份与时间，并报告隐藏文本、外部关系、嵌入对象、Custom XML、签名和宏边界；
- `docx-metadata-edit`：新增、修改或清除选中的 Core Properties 与 Company/Manager，复开后核对请求值、未编辑属性、Word 文字和未触碰 OOXML 部件；精简版保留 Custom Properties、评论/修订身份与缩略图，不创建缺失的属性部件；
- `docx-metadata-remove`：移除受支持属性与缩略图，匿名化受支持作者身份，删除评论/修订时间，然后复开包并核对正文、删除文本、域代码与评论文字不变；
- 签名、宏/ActiveX、加密、ZIP64 与非标准 DOCX 只读；Custom XML、嵌入对象、外链和隐藏/可见内容不会被包装成“已经清理”。

对应在线入口：

- `https://metadataremover.ai/docx-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_viewer`
- `https://metadataremover.ai/docx-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_editor`
- `https://metadataremover.ai/docx-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_remover`

2026-08-09 上线的视频能力已同步为查看、编辑与清理三个精简命令：

- `video-metadata-view`：读取 MP4/MOV 常见 user-data、时间与 Adobe XMP UUID，以及 WebM Info、SimpleTags 和附件存在性；
- `video-metadata-edit`：修改或清除源文件中已有的 Title、Artist、Comment、Copyright 与描述性 Date；新值必须装入原字节槽，保持容器长度与媒体偏移不变，并复读目标值和核对 `mdat`/Cluster 哈希；
- `video-metadata-remove`：用同长度 MP4/MOV `free` box 或 WebM `Void` 替换受支持元数据，不转码、不移动媒体偏移，并复开验证容器、长度、字段和 `mdat`/Cluster 媒体载荷哈希；
- 编辑命令不新增 tag、不扩容、不重建 fast-start offsets 或 WebM Tags；这些完整能力继续保留在线版；
- 三个命令都不含批量；未知私有 atom、codec bitstream、画面、声音、烧录文字和文件系统时间明确保留在边界之外。

对应在线入口：

- `https://metadataremover.ai/video-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_viewer`
- `https://metadataremover.ai/video-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_remover`
- `https://metadataremover.ai/video-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_editor`

MP3 编辑和移除能力已在 2026-08-12 后同步为三个独立可用的精简命令；2026-08-22 上线的独立 Viewer 页面也已补齐对应入口：

- `mp3-metadata-view`：按连续 MPEG Layer III 帧头确认真实格式，读取 ID3v2.3/v2.4、ID3v1、APEv2 文本、Lyrics3v2 存在性和 APIC 封面摘要；
- `mp3-metadata-edit`：修改或清除标题、艺术家、专辑、专辑艺术家、日期、流派、音轨、碟号、评论和 JPEG/PNG/WebP 封面；未修改 ID3 帧、MPEG 音频、APEv2 与 Lyrics3v2 逐字节保留；
- `mp3-metadata-remove`：只复制原始 MPEG 音频区间，完整移除已支持的前后标签，不解码、不重采样、不重压缩；
- 两个写命令都复开输出并核对完整音频哈希与长度、MPEG 版本、采样率、首帧签名以及各自的字段/标签条件；
- 文件名、口播姓名、可听水印、音频指纹、DRM、版权保护和服务端记录明确留在边界之外。

对应在线入口：

- `https://metadataremover.ai/mp3-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_viewer`
- `https://metadataremover.ai/mp3-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_editor`
- `https://metadataremover.ai/mp3-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_remover`

## 后续路线图

1. `verify`：对比清理前后并生成验证报告；
2. `scan`：递归扫描目录中的图片和 PDF 风险；
3. GitHub Action：阻止含敏感元数据的文件进入仓库；
4. Pre-commit Hook：提交前自动检查；
5. C2PA/JUMBF 与 PDF 签名边界检测增强，但在实现密码学验证前不宣称签名有效性验证；
6. 网站新增格式或能力后，同步增加对应的精简命令或工具；编辑类写入必须先具备独立读回与容器/媒体验证；
7. 网站 Batch Workspace 不复制到本仓库；命令保持单文件或开发者自行显式编排的定位。

## 网站链接规范

站点 canonical URL：

`https://metadataremover.ai/`

当前 GitHub 工具的在线清理入口：

`https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker`

包的 `homepage` 使用 canonical URL；README、文档和 CLI 的人类可读提示可使用 UTM 链接。不得在 JSON 输出中加入营销字段。
