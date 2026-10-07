import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  CheckCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import EmptyState from '../components/common/EmptyState';
import FacilityIcon from '../components/common/FacilityIcon';
import MeasureCompare from '../components/common/MeasureCompare';
import { useComplaintStore } from '../stores/complaintStore';
import { usePointStore } from '../stores/pointStore';
import { COMPLAINT_SOURCES, type ComplaintOrder, type ComplaintOrderDraft, type ComplaintSource } from '../types/complaint';
import { FACILITY_TYPES } from '../types/point';
import { matchOrder, type MatchOutcome } from '../utils/reconcile';
import { compareMeasures, latestInspectionOf } from '../utils/measures';
import { todayStr } from '../utils/format';

interface IntakeForm {
  code: string;
  source: ComplaintSource;
  receivedAt: dayjs.Dayjs;
  road: string;
  facilityText: string;
  content: string;
  slope: number | null;
  clearWidth: number | null;
  contact: string;
}

export default function Complaints() {
  const { message } = App.useApp();
  const orders = useComplaintStore((s) => s.orders);
  const addOrder = useComplaintStore((s) => s.addOrder);
  const claimOrder = useComplaintStore((s) => s.claimOrder);
  const revalidatePending = useComplaintStore((s) => s.revalidatePending);
  const points = usePointStore((s) => s.points);
  const inspections = usePointStore((s) => s.inspections);
  const rectifies = usePointStore((s) => s.rectifies);

  const [tab, setTab] = useState<'pending' | 'claimed'>('pending');
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<IntakeForm>();
  const [claiming, setClaiming] = useState<ComplaintOrder | null>(null);
  const [claimPointId, setClaimPointId] = useState<string>('');
  const [claimOperator, setClaimOperator] = useState('李维');

  const pointMap = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);

  /** 待认领工单的对账结果按最新点位实时重算（点位一变立即反映在候选列表里） */
  const liveOutcome = useMemo(() => {
    const map = new Map<string, MatchOutcome>();
    for (const o of orders) {
      if (o.status !== '待认领') continue;
      map.set(o.id, matchOrder(o.road, o.facilityText, o.content, points));
    }
    return map;
  }, [orders, points]);

  const pending = useMemo(() => orders.filter((o) => o.status === '待认领'), [orders]);
  const claimed = useMemo(() => orders.filter((o) => o.status === '已认领'), [orders]);

  const noneCount = pending.filter((o) => liveOutcome.get(o.id)?.kind === 'none').length;
  const ambiguousCount = pending.filter((o) => liveOutcome.get(o.id)?.kind === 'ambiguous').length;

  const openIntake = () => {
    form.setFieldsValue({
      code: `RX-${todayStr().slice(0, 4)}-${String(Date.now()).slice(-4)}`,
      source: '12345热线',
      receivedAt: dayjs(),
      facilityText: FACILITY_TYPES[0],
      slope: null,
      clearWidth: null,
      contact: '',
      road: '',
      content: '',
    });
    setIntakeOpen(true);
  };

  const handleIntake = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const draft: ComplaintOrderDraft = {
        code: values.code.trim(),
        source: values.source,
        receivedAt: (values.receivedAt ?? dayjs()).format('YYYY-MM-DD'),
        road: values.road.trim(),
        facilityText: values.facilityText.trim(),
        content: values.content.trim(),
        slope: values.slope === undefined || values.slope === null ? null : Number(values.slope),
        clearWidth:
          values.clearWidth === undefined || values.clearWidth === null ? null : Number(values.clearWidth),
        contact: values.contact?.trim() ?? '',
      };
      const saved = await addOrder(draft);
      setIntakeOpen(false);
      if (saved.status === '已认领') {
        message.success(`工单 ${saved.code} 唯一命中点位，已直接开出整改条目`);
        setTab('claimed');
      } else {
        message.warning(`工单 ${saved.code} 未能唯一命中，已列入待认领`);
        setTab('pending');
      }
    } catch (e) {
      if (e instanceof Error && e.message) message.error(`工单登记失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClaim = async () => {
    if (!claiming || !claimPointId) {
      message.warning('请选择要认领的点位');
      return;
    }
    try {
      await claimOrder(claiming.id, claimPointId, claimOperator.trim() || '匿名督导员');
      message.success('已认领并开出整改条目');
      setClaiming(null);
      setClaimPointId('');
    } catch (e) {
      message.error(`认领失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRevalidate = async () => {
    if (!pending.length) {
      message.info('没有待认领工单');
      return;
    }
    await revalidatePending();
    const left = useComplaintStore.getState().orders.filter((o) => o.status === '待认领').length;
    if (left < pending.length) message.success(`重新比对完成，${pending.length - left} 张工单唯一命中并已开整改条目`);
    else message.info('重新比对完成，仍有待认领工单需人工确认');
  };

  const pendingColumns: ColumnsType<ComplaintOrder> = [
    { title: '工单号', dataIndex: 'code', width: 140 },
    {
      title: '来源/来件日期',
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Tag color="purple">{row.source}</Tag>
          <Typography.Text type="secondary" className="gb-muted">
            {row.receivedAt}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '道路 / 设施',
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.road}</Typography.Text>
          <Typography.Text type="secondary" className="gb-muted">
            热线写「{row.facilityText}」
          </Typography.Text>
        </Space>
      ),
    },
    { title: '投诉内容', dataIndex: 'content', ellipsis: true },
    {
      title: '外部实测',
      width: 130,
      render: (_, row) => (
        <Space size={4} wrap>
          {row.slope !== null ? <Tag color="orange">坡度 {row.slope}%</Tag> : null}
          {row.clearWidth !== null ? <Tag color="orange">净宽 {row.clearWidth}cm</Tag> : null}
          {row.slope === null && row.clearWidth === null ? (
            <Typography.Text type="secondary">无</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '实时对账结果',
      width: 260,
      render: (_, row) => {
        const outcome = liveOutcome.get(row.id);
        if (!outcome) return <Typography.Text type="secondary">—</Typography.Text>;
        if (outcome.kind === 'unique') {
          return (
            <Space size={4} wrap data-testid={`live-unique-${row.id}`}>
              <Tag color="success">
                <CheckCircleOutlined /> 重新比对已唯一命中
              </Tag>
              <Link to={`/points/${outcome.point?.id}`}>{outcome.point?.name}</Link>
            </Space>
          );
        }
        if (outcome.kind === 'ambiguous') {
          return (
            <Space size={4} wrap data-testid={`live-ambiguous-${row.id}`}>
              <Tag color="error">
                <QuestionCircleOutlined /> 对上 {outcome.candidates.length} 处
              </Tag>
              {outcome.candidates.slice(0, 3).map((c) => (
                <Link key={c.point.id} to={`/points/${c.point.id}`} className="gb-muted">
                  {c.point.code}
                </Link>
              ))}
            </Space>
          );
        }
        return (
          <Tag color="default" data-testid={`live-none-${row.id}`}>
            对不上点位
          </Tag>
        );
      },
    },
    {
      title: '操作',
      width: 170,
      render: (_, row) => {
        const outcome = liveOutcome.get(row.id);
        return (
          <Space size={4}>
            <Button
              size="small"
              type="primary"
              ghost
              onClick={() => {
                setClaiming(row);
                setClaimPointId(outcome?.kind === 'unique' ? outcome.point?.id ?? '' : '');
              }}
              data-testid={`claim-${row.id}`}
            >
              督导员认领
            </Button>
            {outcome?.kind === 'none' ? (
              <Link to="/points/new">
                <Button size="small">补登点位</Button>
              </Link>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const claimedColumns: ColumnsType<ComplaintOrder> = [
    { title: '工单号', dataIndex: 'code', width: 140 },
    { title: '来源', dataIndex: 'source', width: 120, render: (v: string) => <Tag color="purple">{v}</Tag> },
    {
      title: '认领点位',
      width: 220,
      render: (_, row) => {
        const p = pointMap.get(row.pointId);
        if (!p) return <Typography.Text type="warning">点位已失效（{row.pointId}）</Typography.Text>;
        return (
          <Space size={6}>
            <FacilityIcon type={p.facilityType} />
            <Link to={`/points/${p.id}`}>{p.name}</Link>
          </Space>
        );
      },
    },
    {
      title: '认领方式',
      width: 150,
      render: (_, row) =>
        row.claimMode === 'auto' ? (
          <Tag color="success">自动对账命中</Tag>
        ) : (
          <Space size={4} direction="vertical">
            <Tag color="blue">人工认领</Tag>
            <Typography.Text type="secondary" className="gb-muted">
              {row.claimedBy}
            </Typography.Text>
          </Space>
        ),
    },
    { title: '投诉内容', dataIndex: 'content', ellipsis: true },
    {
      title: '整改条目',
      width: 120,
      render: (_, row) => {
        const plan = rectifies.find((r) => r.id === row.rectifyId);
        if (!plan) return <Typography.Text type="warning">条目缺失</Typography.Text>;
        return <Link to="/rectify">{plan.status}</Link>;
      },
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">工单对账</h1>
          <Typography.Text type="secondary">
            热线无障碍投诉按「道路 + 设施类型」对点位：唯一命中直接开整改条目；对不上或对上多处先列待认领，督导员确认后再写。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={handleRevalidate} data-testid="revalidate-orders">
            重新比对未认领
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openIntake} data-testid="intake-order">
            登记热线工单
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">工单总数</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600 }} data-testid="order-total">
              {orders.length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">待认领</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#d46b08' }} data-testid="order-pending">
              {pending.length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">对不上点位</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#8c8c8c' }} data-testid="order-none">
              {noneCount}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">对上多处（疑似重复挂点）</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#cf1322' }} data-testid="order-ambiguous">
              {ambiguousCount}
            </div>
          </Card>
        </Col>
      </Row>

      <Card size="small" data-testid="order-tabs-card">
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as 'pending' | 'claimed')}
          items={[
            {
              key: 'pending',
              label: `待认领（${pending.length}）`,
              children: pending.length ? (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="候选随点位变化实时重算；新点位补登或核验更新后，唯一命中的工单会自动认领并开整改条目，无需手动处理。"
                  />
                  <Table<ComplaintOrder>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={pending}
                    columns={pendingColumns}
                    expandable={{
                      expandedRowRender: (row) => {
                        const outcome = liveOutcome.get(row.id);
                        return (
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Typography.Text type="secondary">对账说明：{row.matchNote || outcome?.note}</Typography.Text>
                            {outcome && outcome.candidates.length ? (
                              <Table
                                rowKey={(c) => c.point.id}
                                size="small"
                                pagination={false}
                                dataSource={outcome.candidates}
                                columns={[
                                  {
                                    title: '候选点位',
                                    render: (_, c) => (
                                      <Link to={`/points/${c.point.id}`}>
                                        {c.point.code} {c.point.name}
                                      </Link>
                                    ),
                                  },
                                  { title: '行政区', width: 90, render: (_, c) => c.point.district },
                                  { title: '所在道路', dataIndex: ['point', 'location'], ellipsis: true },
                                  {
                                    title: '设施类型',
                                    width: 120,
                                    render: (_, c) => (
                                      <Space size={4}>
                                        <FacilityIcon type={c.point.facilityType} />
                                        {c.point.facilityType}
                                      </Space>
                                    ),
                                  },
                                  { title: '匹配分', dataIndex: 'score', width: 80 },
                                  {
                                    title: '操作',
                                    width: 110,
                                    render: (_, c) => (
                                      <Button
                                        size="small"
                                        type="primary"
                                        ghost
                                        onClick={() => {
                                          setClaiming(row);
                                          setClaimPointId(c.point.id);
                                        }}
                                      >
                                        确认为该点
                                      </Button>
                                    ),
                                  },
                                ]}
                              />
                            ) : (
                              <Typography.Text type="secondary">
                                库内无候选。可先
                                <Link to="/points/new">补登点位</Link>
                                ，保存后系统会自动重新比对；也可点「督导员认领」在全部点位中指定。
                              </Typography.Text>
                            )}
                          </Space>
                        );
                      },
                    }}
                  />
                </>
              ) : (
                <EmptyState
                  title="没有待认领工单"
                  description="新登记的工单若对不上或对上多处，会出现在这里等督导员确认"
                  compact
                />
              ),
            },
            {
              key: 'claimed',
              label: `已认领 / 已开整改（${claimed.length}）`,
              children: claimed.length ? (
                <Table<ComplaintOrder>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={claimed}
                  columns={claimedColumns}
                  expandable={{
                    expandedRowRender: (row) => {
                      const latest = latestInspectionOf(inspections, row.pointId);
                      const compare = compareMeasures(
                        { slope: row.slope, clearWidth: row.clearWidth },
                        latest,
                      );
                      return (
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Typography.Text type="secondary">{row.matchNote}</Typography.Text>
                          <div>
                            <Typography.Text strong>外部实测 vs 点位最新核验（两边都留，标明来源）</Typography.Text>
                            <div style={{ marginTop: 6 }}>
                              <MeasureCompare result={compare} />
                            </div>
                          </div>
                          {latest ? (
                            <Typography.Text type="secondary" className="gb-muted">
                              最新核验 {latest.date}（{latest.inspector}）结论：{latest.conclusion}
                              {latest.problem ? ` · ${latest.problem}` : ''}
                            </Typography.Text>
                          ) : (
                            <Typography.Text type="warning">该点位尚无核验记录</Typography.Text>
                          )}
                        </Space>
                      );
                    },
                  }}
                />
              ) : (
                <EmptyState title="暂无已认领工单" compact />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="登记热线投诉工单"
        open={intakeOpen}
        onCancel={() => setIntakeOpen(false)}
        onOk={handleIntake}
        confirmLoading={saving}
        okText="登记并立即对账"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label="工单号" rules={[{ required: true, message: '请填写工单号' }]}>
                <Input placeholder="RX-2025-0605" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="source" label="来源" rules={[{ required: true }]}>
                <Select options={COMPLAINT_SOURCES.map((s) => ({ value: s, label: s }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="receivedAt" label="来件日期" rules={[{ required: true, message: '请选择来件日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contact" label="联系电话（可空）">
                <Input placeholder="138****0000" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="road" label="反映道路" rules={[{ required: true, message: '请填写道路，作为对账主键' }]}>
                <Input placeholder="如 中关村大街" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="facilityText" label="反映设施（按热线原文即可）" rules={[{ required: true }]}>
                <AutoFacilityInput />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="content" label="投诉内容" rules={[{ required: true, message: '请填写投诉内容' }]}>
                <Input.TextArea rows={3} placeholder="如 路口坡道太陡，轮椅上不去" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="slope" label="外部实测坡度 %（可空）">
                <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} placeholder="未提供留空" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="clearWidth" label="外部实测净宽 cm（可空）">
                <InputNumber min={0} max={500} style={{ width: '100%' }} placeholder="未提供留空" />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Text type="secondary" className="gb-muted">
            坡度、净宽按外部实测留档，与点位最新核验对不上时两边都保留并标出来源，不以任一方覆盖。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title={claiming ? `督导员认领 · ${claiming.code}` : '督导员认领'}
        open={Boolean(claiming)}
        onCancel={() => setClaiming(null)}
        onOk={handleClaim}
        okText="确认认领并开整改条目"
        destroyOnClose
      >
        {claiming ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert type="warning" showIcon message="人工认领后立即开出整改条目，工单状态置为已认领。" />
            <Typography.Text>{claiming.content}</Typography.Text>
            <div>
              <Typography.Text>认领到点位</Typography.Text>
              <Select
                showSearch
                style={{ width: '100%', marginTop: 4 }}
                value={claimPointId || undefined}
                onChange={setClaimPointId}
                placeholder="选择点位"
                optionFilterProp="label"
                options={points.map((p) => ({
                  value: p.id,
                  label: `${p.code} ${p.name}（${p.district} · ${p.location}）`,
                }))}
              />
            </div>
            <div>
              <Typography.Text>督导员署名</Typography.Text>
              <Input style={{ marginTop: 4 }} value={claimOperator} onChange={(e) => setClaimOperator(e.target.value)} />
            </div>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}

/** 设施输入：标准类型下拉，也允许手填热线原文（如「坡道」），对账时做同义归一 */
function AutoFacilityInput() {
  return (
    <AutoComplete
      placeholder="选择或输入热线原文措辞"
      options={FACILITY_TYPES.map((t) => ({ value: t, label: t }))}
      filterOption={(input, option) => (option?.value ?? '').includes(input)}
    />
  );
}
