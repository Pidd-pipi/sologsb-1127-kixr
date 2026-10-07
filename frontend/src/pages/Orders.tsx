import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  FileAddOutlined,
  WarningOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import FacilityIcon from '../components/common/FacilityIcon';
import StatusBadge from '../components/common/StatusBadge';
import { useReconcile, type OrderRow } from '../hooks/useReconcile';
import { useOrderStore } from '../stores/orderStore';
import { usePointStore } from '../stores/pointStore';
import { FACILITY_TYPES, type FacilityType } from '../types/point';
import { SOURCE_INSPECTION, SOURCE_ORDER } from '../types/order';
import { isOverdue, todayStr } from '../utils/format';

/** 外部实测 vs 点位最新核验：两边都留，差异标来源 */
function MeasureCompare({ row }: { row: OrderRow }) {
  const { diff } = row;
  if (diff.noInspection && (diff.slope.orderValue !== null || diff.clearWidth.orderValue !== null)) {
    return (
      <Typography.Text type="secondary" className="gb-muted">
        点位尚无核验，工单实测（{SOURCE_ORDER}）待复核
      </Typography.Text>
    );
  }
  const cells = [diff.slope, diff.clearWidth].filter((c) => c.orderValue !== null);
  if (!cells.length) {
    return <Typography.Text type="secondary" className="gb-muted">工单未带实测值</Typography.Text>;
  }
  return (
    <Space direction="vertical" size={2} data-testid={`measure-${row.order.id}`}>
      {cells.map((c) => (
        <Space key={c.field} size={6} wrap>
          <Typography.Text type="secondary">{c.label}</Typography.Text>
          <Tag color="processing" data-source="order">
            {SOURCE_ORDER} {c.orderValue}
            {c.unit}
          </Tag>
          {c.inspectionValue !== null ? (
            <Tag color={c.conflict ? 'error' : 'success'} data-source="inspection">
              {SOURCE_INSPECTION}
              {c.inspectionDate ? `（${c.inspectionDate}）` : ''} {c.inspectionValue}
              {c.unit}
            </Tag>
          ) : (
            <Tag>点位暂无{c.label}核验</Tag>
          )}
          {c.conflict && (
            <Tag color="warning" data-testid={`conflict-${c.field}-${row.order.id}`}>
              对不上 · 差 {c.delta! > 0 ? '+' : ''}
              {c.delta}
              {c.unit}
            </Tag>
          )}
        </Space>
      ))}
    </Space>
  );
}

export default function Orders() {
  const { message } = App.useApp();
  const { rows, noHit, multiHit, opened, pointMap } = useReconcile();
  const claim = useOrderStore((s) => s.claim);
  const addOrder = useOrderStore((s) => s.addOrder);
  const points = usePointStore((s) => s.points);
  const [claiming, setClaiming] = useState<OrderRow | null>(null);
  const [chosenPoint, setChosenPoint] = useState<string>('');
  const [claimNote, setClaimNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{
    code: string;
    road: string;
    facilityType: FacilityType;
    reporter: string;
    content: string;
    slope: number | null;
    clearWidth: number | null;
  }>();

  const candidatePoints = useMemo(() => {
    if (!claiming?.match) return [];
    return claiming.match.candidates
      .map((c) => pointMap.get(c.pointId))
      .filter(Boolean)
      .map((p) => p!);
  }, [claiming, pointMap]);

  const pointOptions = useMemo(
    () => points.map((p) => ({ value: p.id, label: `${p.code} ${p.name}（${p.location}）` })),
    [points],
  );

  const openClaim = (row: OrderRow) => {
    setClaiming(row);
    setClaimNote('');
    setChosenPoint(row.match?.candidates[0]?.pointId ?? '');
  };

  const handleClaim = async () => {
    if (!claiming) return;
    if (!chosenPoint) {
      message.warning('请先选择一个点位');
      return;
    }
    setSubmitting(true);
    try {
      await claim(claiming.order.id, chosenPoint, claimNote.trim());
      message.success('已确认点位并开出整改条目');
      setClaiming(null);
    } catch (e) {
      message.error(`认领失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const created = await addOrder({
        code: v.code.trim(),
        receivedAt: todayStr(),
        reporter: v.reporter.trim() || '热线转办',
        road: v.road.trim(),
        facilityType: v.facilityType,
        content: v.content.trim(),
        slope: v.slope ?? null,
        clearWidth: v.clearWidth ?? null,
      });
      message.success('工单已录入并完成自动对账');
      setCreating(false);
      form.resetFields();
      const target = useOrderStore.getState().getOrder(created.id);
      if (target?.status === '已开单') {
        message.success('按道路与设施类型唯一命中点位，已直接开单');
      }
    } catch (e) {
      if (e instanceof Error && (e as { errorFields?: unknown }).errorFields) return;
      message.error(`录入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const pendingColumns: ColumnsType<OrderRow> = [
    { title: '工单编号', dataIndex: ['order', 'code'], width: 150 },
    { title: '受理日期', dataIndex: ['order', 'receivedAt'], width: 110 },
    {
      title: '设施类型',
      dataIndex: ['order', 'facilityType'],
      width: 130,
      render: (t: FacilityType) => <FacilityIcon type={t} withLabel />,
    },
    { title: '道路（热线描述）', dataIndex: ['order', 'road'], width: 150 },
    {
      title: '命中情况',
      width: 220,
      render: (_, row) => {
        if (row.match?.kind === 'none') {
          return (
            <Space size={4} wrap>
              <Tag color="default">0 处命中</Tag>
              <Typography.Text type="secondary" className="gb-muted">
                按道路与类型对不上点位，登记点位后自动重新比对
              </Typography.Text>
            </Space>
          );
        }
        return (
          <Space direction="vertical" size={2}>
            <Tag color="orange" data-testid={`multi-${row.order.id}`}>
              {row.match?.candidates.length} 处候选
            </Tag>
            {row.match?.candidates.map((c) => {
              const p = pointMap.get(c.pointId);
              return p ? (
                <Link key={c.pointId} to={`/points/${p.id}`} style={{ fontSize: 12 }}>
                  {p.code} {p.name}
                </Link>
              ) : null;
            })}
          </Space>
        );
      },
    },
    { title: '投诉内容', dataIndex: ['order', 'content'], ellipsis: true },
    {
      title: '操作',
      width: 130,
      render: (_, row) => (
        <Button
          size="small"
          type="primary"
          ghost
          icon={<AimOutlined />}
          onClick={() => openClaim(row)}
          data-testid={`claim-${row.order.id}`}
        >
          确认点位
        </Button>
      ),
    },
  ];

  const openedColumns: ColumnsType<OrderRow> = [
    { title: '工单编号', dataIndex: ['order', 'code'], width: 150 },
    {
      title: '点位 / 认领方式',
      width: 240,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          {row.point ? (
            <Link to={`/points/${row.point.id}`}>{row.point.name}</Link>
          ) : (
            row.order.pointId
          )}
          <Tag color={row.order.matchMethod === '自动' ? 'blue' : 'geekblue'}>
            {row.order.matchMethod === '自动' ? '唯一命中 · 自动开单' : '督导员确认开单'}
          </Tag>
        </Space>
      ),
    },
    {
      title: '整改条目',
      render: (_, row) => {
        if (!row.rectify) {
          return <Typography.Text type="secondary">条目已并入同点位既有整改单</Typography.Text>;
        }
        const overdue = isOverdue(row.rectify.deadline, row.rectify.status);
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text>{row.rectify.requirement}</Typography.Text>
            <Space size={6}>
              <StatusBadge value={row.rectify.status} kind="rectify" />
              <Typography.Text type="secondary" className="gb-muted">
                期限 {row.rectify.deadline}
                {overdue ? ' · 逾期' : ''}
              </Typography.Text>
            </Space>
          </Space>
        );
      },
    },
    {
      title: '实测对撞（两边留档）',
      width: 420,
      render: (_, row) => <MeasureCompare row={row} />,
    },
  ];

  const conflictCount = opened.filter((r) => r.diff.hasConflict).length;

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">12345 工单对账</h1>
          <Typography.Text type="secondary">
            按道路与设施类型把热线投诉配到点位：唯一命中直接开整改单；对不上或对上多处先列待认领，督导员确认后开单。
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<FileAddOutlined />}
          onClick={() => setCreating(true)}
          data-testid="new-order"
        >
          录入热线工单
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">工单总数</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600 }} data-testid="order-total">
              {rows.length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">待认领（无命中 / 多处命中）</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#d46b08' }} data-testid="order-pending">
              {noHit.length + multiHit.length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">已开单</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#389e0d' }} data-testid="order-opened">
              {opened.length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">实测对不上（需复核）</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#cf1322' }} data-testid="order-conflict">
              {conflictCount}
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        style={{ marginTop: 16 }}
        title={
          <Space size={8}>
            <WarningOutlined />
            <span>待认领工单（督导员确认后开单）</span>
            <Tag color="orange">{noHit.length + multiHit.length}</Tag>
          </Space>
        }
      >
        {noHit.length + multiHit.length ? (
          <Table<OrderRow>
            rowKey={(r) => r.order.id}
            size="small"
            pagination={false}
            dataSource={[...multiHit, ...noHit]}
            columns={pendingColumns}
          />
        ) : (
          <EmptyState
            title="没有待认领工单"
            description="所有热线工单都已按道路与设施类型配上点位"
            compact
          />
        )}
      </Card>

      <Card
        size="small"
        style={{ marginTop: 16 }}
        title={
          <Space size={8}>
            <CheckCircleOutlined />
            <span>已开单与实测对撞</span>
            <Tag color="green">{opened.length}</Tag>
          </Space>
        }
      >
        {conflictCount > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="存在热线外部实测与点位最新核验对不上的工单"
            description="两边数值均已保留并标注来源，建议安排现场复测后再更新核验。"
          />
        )}
        {opened.length ? (
          <Table<OrderRow>
            rowKey={(r) => r.order.id}
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={opened}
            columns={openedColumns}
          />
        ) : (
          <EmptyState title="暂无已开单工单" compact />
        )}
      </Card>

      {/* 督导员人工认领 */}
      <Modal
        title={claiming ? `确认点位 · 工单 ${claiming.order.code}` : '确认点位'}
        open={Boolean(claiming)}
        onCancel={() => setClaiming(null)}
        onOk={handleClaim}
        confirmLoading={submitting}
        okText="确认并开整改单"
        destroyOnClose
        width={640}
      >
        {claiming && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="道路 / 类型">
                {claiming.order.road} · <FacilityIcon type={claiming.order.facilityType} withLabel />
              </Descriptions.Item>
              <Descriptions.Item label="投诉内容">{claiming.order.content}</Descriptions.Item>
            </Descriptions>

            {claiming.match?.kind === 'multiple' ? (
              <Alert
                type="warning"
                showIcon
                message={`该道路上有 ${candidatePoints.length} 处同类型设施，请确认工单具体点位`}
              />
            ) : (
              <Alert
                type="info"
                showIcon
                message="未按道路与类型自动命中点位，请从全部点位中指定（或先去点位登记补登后再对账）"
              />
            )}

            <div>
              <Typography.Text>选择点位</Typography.Text>
              <Select
                showSearch
                style={{ width: '100%', marginTop: 4 }}
                value={chosenPoint || undefined}
                onChange={setChosenPoint}
                optionFilterProp="label"
                options={claiming.match?.kind === 'multiple' ? candidatePoints.map((p) => ({
                  value: p.id,
                  label: `${p.code} ${p.name}（${p.location}）`,
                })) : pointOptions}
                placeholder="选择要挂接的点位"
                data-testid="claim-point-select"
              />
            </div>
            <div>
              <Typography.Text>认领备注</Typography.Text>
              <Input.TextArea
                rows={2}
                style={{ marginTop: 4 }}
                value={claimNote}
                onChange={(e) => setClaimNote(e.target.value)}
                placeholder="如：电话回访确认是路口西侧那处盲道"
              />
            </div>
          </Space>
        )}
      </Modal>

      {/* 录入新热线工单 */}
      <Modal
        title="录入 12345 热线工单"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={handleCreate}
        confirmLoading={submitting}
        okText="录入并自动对账"
        destroyOnClose
        width={620}
      >
        <Form form={form} layout="vertical" initialValues={{ facilityType: '缘石坡道', slope: null, clearWidth: null }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label="工单编号" rules={[{ required: true, message: '请填写工单编号' }]}>
                <Input placeholder="如 12345-2025-1128" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="facilityType"
                label="设施类型（热线归类）"
                rules={[{ required: true }]}
              >
                <Select options={FACILITY_TYPES.map((t) => ({ value: t, label: t }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="road" label="道路或位置（热线描述）" rules={[{ required: true, message: '请填写道路' }]}>
                <Input placeholder="如 莲花池东路北侧" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="reporter" label="来电人">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="slope" label="外部实测坡度 %（选填）">
                <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="clearWidth" label="外部实测净宽 cm（选填）">
                <InputNumber min={0} max={500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="content" label="投诉内容" rules={[{ required: true, message: '请填写投诉内容' }]}>
                <Input.TextArea rows={3} placeholder="记录热线转来的问题描述" />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Text type="secondary" className="gb-muted">
            录入后立即按道路与设施类型对账：唯一命中直接开整改单，0 / 多处命中进入待认领。
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}
